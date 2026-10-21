"""Three distinct truck routes, quickly.

TomTom's own alternative routes are the best choice, but computing them is slow: six to eleven
seconds for trips of a few hundred miles or more, and on very long trips the request fails
outright. A single fastest route takes one to two seconds. So both are requested at once, and as
soon as the fastest route is known, detours start too: routes through a point offset to either
side of its middle, kept only if most of each runs on roads of its own.

Whichever complete set of three is ready first is used, with one preference: for the first
``ALTERNATIVES_WAIT_S`` seconds only TomTom's own alternatives can complete the set. Nothing waits
longer than ``MAX_WAIT_S``; a slow candidate (a via point at sea, for example) is simply dropped
and the plan says when fewer than three distinct routes were found.
"""

import logging
import time
from collections.abc import Callable, Iterator, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import datetime
from itertools import batched

from routing.clients.tomtom import NoRouteFoundError, TomTomClient, TomTomError, TruckRoute
from routing.geo import LatLon, bearing_deg, destination, fraction_near, haversine_m, sample_along
from routing.services.checkpoints import RouteTrack

logger = logging.getLogger(__name__)

ROUTE_COUNT = 3
# How long, from the start, to wait for TomTom's own alternatives before using detours.
ALTERNATIVES_WAIT_S = 4.0
# The longest the route search waits in all, whatever is still running. Very long trips need
# it: their fastest route alone takes about eight seconds, and each detour as long again.
MAX_WAIT_S = 20.0
DETOURS_AT_ONCE = 2
DETOUR_WAVES = 2
DETOUR_FRACTION = 0.15  # Via point offset, as a share of the straight-line trip length.
MIN_DETOUR_M = 20_000
MAX_DETOUR_M = 150_000
SAME_ROAD_RADIUS_M = 2_000
MAX_SHARED_ROAD = 0.9
CANDIDATE_SAMPLES = 200

Request = Future[list[TruckRoute]]


@dataclass(frozen=True, slots=True)
class RouteOption:
    route: TruckRoute
    detour: bool


def find_route_options(
    client: TomTomClient,
    origin: LatLon,
    target: LatLon,
    *,
    depart_at: datetime,
    load_lb: float,
) -> list[RouteOption]:
    def routes(locations: Sequence[LatLon], alternatives: int = 0) -> list[TruckRoute]:
        return client.truck_routes(
            locations, depart_at=depart_at, load_lb=load_lb, alternatives=alternatives
        )

    started = time.monotonic()
    prefer_tomtom_until = started + ALTERNATIVES_WAIT_S
    give_up_at = started + MAX_WAIT_S
    # Requests that turn out not to be needed finish in the background; nothing waits for them.
    pool = ThreadPoolExecutor(max_workers=2 + DETOURS_AT_ONCE * DETOUR_WAVES)
    try:
        alternatives = pool.submit(routes, [origin, target], ROUTE_COUNT - 1)
        fastest = pool.submit(routes, [origin, target])
        main = _main_routes(fastest, alternatives)
        tomtom: list[TruckRoute] | None = main if alternatives.done() else None
        if tomtom and len(tomtom) >= ROUTE_COUNT:
            return _options(tomtom, [])

        waves = _detour_points(main[0], origin, target)
        detours = set(_submit(pool, routes, origin, target, next(waves, [])))
        pending = detours | ({alternatives} if tomtom is None else set())
        accepted: list[TruckRoute] = []

        while pending:
            now = time.monotonic()
            if now >= give_up_at:
                break
            # Wake up when a request finishes, or when detours become allowed to complete the set.
            until = prefer_tomtom_until if now < prefer_tomtom_until else give_up_at
            done, pending = wait(pending, timeout=until - now, return_when=FIRST_COMPLETED)
            for request in done:
                found = _result(request)
                if request is alternatives:
                    tomtom = found or main
                elif found and _is_distinct(found[0], [main[0], *accepted]):
                    accepted.append(found[0])
            if tomtom and len(tomtom) >= ROUTE_COUNT:
                return _options(tomtom, [])
            base = tomtom or main[:1]
            if time.monotonic() >= prefer_tomtom_until or tomtom is not None:
                options = _options(base, accepted)
                if len(options) >= ROUTE_COUNT:
                    return options
            # Farther via points, once the nearer ones are all back without enough routes.
            if not (pending & detours):
                wave = _submit(pool, routes, origin, target, next(waves, []))
                detours |= set(wave)
                pending |= set(wave)
        return _options(tomtom or main[:1], accepted)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _options(routes: Sequence[TruckRoute], detours: Sequence[TruckRoute]) -> list[RouteOption]:
    """TomTom's routes first, then detours that also differ from them, up to three in all.

    Detours finish in no particular order; taking the quickest first keeps the result, and so
    the route letters, the same from one run to the next.
    """
    options = [RouteOption(route, detour=False) for route in routes[:ROUTE_COUNT]]
    for detour in sorted(detours, key=lambda route: route.travel_time_s):
        if len(options) < ROUTE_COUNT and _is_distinct(detour, [o.route for o in options]):
            options.append(RouteOption(detour, detour=True))
    return options


def _main_routes(fastest: Request, alternatives: Request) -> list[TruckRoute]:
    """The fastest route; if that request failed, TomTom's alternatives stand in for it."""
    try:
        main = fastest.result()
    except NoRouteFoundError:
        raise
    except TomTomError:
        main = _result(alternatives)
        if not main:
            raise
    if not main:
        raise NoRouteFoundError("TomTom returned no routes.")
    return main


def _submit(
    pool: ThreadPoolExecutor,
    routes: Callable[[Sequence[LatLon]], list[TruckRoute]],
    origin: LatLon,
    target: LatLon,
    vias: Sequence[LatLon],
) -> list[Request]:
    return [pool.submit(routes, [origin, via, target]) for via in vias]


def _result(request: Request, timeout: float | None = None) -> list[TruckRoute]:
    """The routes a request found, or none if it failed or is still running after ``timeout``."""
    try:
        return request.result(timeout=timeout)
    except FutureTimeoutError:
        return []
    except TomTomError as error:
        logger.info("Route candidate skipped: %s", type(error).__name__)
        return []


def _detour_points(main: TruckRoute, origin: LatLon, target: LatLon) -> Iterator[list[LatLon]]:
    """Via points beside the middle of the main route, in waves: near ones, then farther ones."""
    track = RouteTrack(main)
    middle, _ = track.locate(track.length_m / 2)
    heading = bearing_deg(origin, target)
    offset = min(max(haversine_m(origin, target) * DETOUR_FRACTION, MIN_DETOUR_M), MAX_DETOUR_M)
    points = [
        destination(middle, (heading + turn) % 360, distance)
        for distance, turn in ((offset, 90), (offset, 270), (2 * offset, 90), (2 * offset, 270))
    ]
    for wave in batched(points, DETOURS_AT_ONCE):
        yield list(wave)


def _is_distinct(candidate: TruckRoute, existing: Sequence[TruckRoute]) -> bool:
    step = max(candidate.length_m / CANDIDATE_SAMPLES, 1.0)
    samples = list(sample_along(candidate.points, step))
    return all(
        fraction_near(samples, route.points, SAME_ROAD_RADIUS_M) < MAX_SHARED_ROAD
        for route in existing
    )
