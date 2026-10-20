"""Three distinct truck routes, adding detours when TomTom returns fewer alternatives.

TomTom may return fewer alternatives than requested when no sensible ones exist. Extra
candidates are then requested through a via point offset to either side of the main route's
midpoint. A candidate is kept only if most of it runs on different roads from every route
already found.
"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime

from routing.clients.tomtom import NoRouteFoundError, TomTomClient, TomTomError, TruckRoute
from routing.geo import LatLon, bearing_deg, destination, fraction_near, haversine_m, sample_along
from routing.services.checkpoints import RouteTrack

logger = logging.getLogger(__name__)

ROUTE_COUNT = 3
DETOUR_FRACTION = 0.15  # Via point offset, as a share of the straight-line trip length.
MIN_DETOUR_M = 20_000
MAX_DETOUR_M = 150_000
SAME_ROAD_RADIUS_M = 2_000
MAX_SHARED_ROAD = 0.9
CANDIDATE_SAMPLES = 200


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
    routes = client.truck_routes(
        [origin, target], depart_at=depart_at, load_lb=load_lb, alternatives=ROUTE_COUNT - 1
    )
    if not routes:
        raise NoRouteFoundError("TomTom returned no routes.")
    options = [RouteOption(route, detour=False) for route in routes[:ROUTE_COUNT]]

    for via in _detour_points(routes[0], origin, target):
        if len(options) >= ROUTE_COUNT:
            break
        try:
            candidates = client.truck_routes(
                [origin, via, target], depart_at=depart_at, load_lb=load_lb
            )
        except TomTomError as error:
            logger.info("Detour candidate skipped: %s", type(error).__name__)
            continue
        if candidates and _is_distinct(candidates[0], [o.route for o in options]):
            options.append(RouteOption(candidates[0], detour=True))
    return options


def _detour_points(main: TruckRoute, origin: LatLon, target: LatLon) -> Iterator[LatLon]:
    track = RouteTrack(main)
    middle, _ = track.locate(track.length_m / 2)
    heading = bearing_deg(origin, target)
    offset = min(max(haversine_m(origin, target) * DETOUR_FRACTION, MIN_DETOUR_M), MAX_DETOUR_M)
    for distance, turn in ((offset, 90), (offset, 270), (2 * offset, 90), (2 * offset, 270)):
        yield destination(middle, (heading + turn) % 360, distance)


def _is_distinct(candidate: TruckRoute, existing: list[TruckRoute]) -> bool:
    step = max(candidate.length_m / CANDIDATE_SAMPLES, 1.0)
    samples = list(sample_along(candidate.points, step))
    return all(
        fraction_near(samples, route.points, SAME_ROAD_RADIUS_M) < MAX_SHARED_ROAD
        for route in existing
    )
