"""Plans a trip: resolves the places, finds route options, places checkpoints, looks up the
weather at each checkpoint for the truck's arrival time, scores every route and recommends one.
The corridor heatmap's weather is fetched at the same time as the checkpoints'; if only that
lookup fails, the plan is still returned, without a heatmap.

Plans are cached for a few minutes, so reloading the same trip calls neither TomTom nor
Open-Meteo again. Only the simplified geometry is kept, which keeps cached plans small.
"""

import hashlib
import logging
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime

from django.core.cache import cache

from routing.clients.open_meteo import OpenMeteoClient, WeatherError
from routing.clients.tomtom import Place, TomTomClient
from routing.geo import METERS_PER_MILE, LatLon, haversine_m, simplify
from routing.risk import (
    CheckpointRisk,
    Recommendation,
    RiskSegment,
    RouteRisk,
    assess_checkpoint,
    checkpoint_coverage,
    recommend,
)
from routing.risk import RouteOption as RankedRoute
from routing.services.checkpoints import Checkpoint, place_checkpoints
from routing.services.heatmap import Heatmap, corridor_heatmap
from routing.services.places import Location, resolve
from routing.services.route_options import RouteOption, find_route_options
from routing.services.weather import Stop, Weather, weather_at_stops

logger = logging.getLogger(__name__)

GEOMETRY_TOLERANCE_M = 30
# Forecasts are hourly and each forecast location counts against the weather quota, so a plan
# is kept for an hour.
PLAN_CACHE_S = 60 * 60
# A plan whose heatmap could not be fetched is kept only briefly, so the heatmap returns soon.
PLAN_WITHOUT_HEATMAP_CACHE_S = 60
MIN_TRIP_M = 1_000
# The longest trip planned. US coast to coast is about 2,800 miles; longer trips would need
# thousands of forecast locations and could run past the 16 day forecast.
MAX_TRIP_MI = 3_500
ROUTE_IDS = ("A", "B", "C")


class TripError(ValueError):
    """The trip cannot be planned as asked; the message says why, for the destination field."""


class SamePlaceError(TripError):
    """The origin and destination resolve to (nearly) the same point."""


class TripTooLongError(TripError):
    """Even the shortest way between the places is longer than ``MAX_TRIP_MI``."""

    def __init__(self, miles: float) -> None:
        super().__init__(
            f"This trip is about {miles:,.0f} mi; Clearway plans trips of up to "
            f"{MAX_TRIP_MI:,} mi. Split it into shorter legs."
        )


@dataclass(frozen=True, slots=True)
class TripRequest:
    origin: Location
    destination: Location
    departure: datetime
    load_lb: int
    interval_mi: int


@dataclass(frozen=True, slots=True)
class AssessedCheckpoint:
    checkpoint: Checkpoint
    weather: Weather
    risk: CheckpointRisk


@dataclass(frozen=True, slots=True)
class PlannedRoute:
    route_id: str
    distance_m: float
    duration_s: float
    traffic_delay_s: float
    departure: datetime
    arrival: datetime
    detour: bool
    geometry: tuple[LatLon, ...]
    checkpoints: tuple[AssessedCheckpoint, ...]
    risk: RouteRisk


@dataclass(frozen=True, slots=True)
class RoutePlan:
    origin: Place
    destination: Place
    load_lb: int
    interval_mi: int
    routes: tuple[PlannedRoute, ...]
    recommendation: Recommendation
    heatmap: Heatmap | None = None

    def rank(self, route_id: str) -> int:
        """1 for the recommended route, then upwards in ranking order."""
        ranked = [option.route_id for option in self.recommendation.ranked]
        return ranked.index(route_id) + 1


def plan_trip(client: TomTomClient, weather: OpenMeteoClient, trip: TripRequest) -> RoutePlan:
    # The two places are looked up at the same time.
    with ThreadPoolExecutor(max_workers=2) as pool:
        origin_lookup = pool.submit(resolve, client, trip.origin)
        target_lookup = pool.submit(resolve, client, trip.destination)
        origin, target = origin_lookup.result(), target_lookup.result()
    if haversine_m(origin.position, target.position) < MIN_TRIP_M:
        raise SamePlaceError("The origin and destination are the same place.")
    # The road is never shorter than the straight line, so this needs no routing request.
    straight_mi = haversine_m(origin.position, target.position) / METERS_PER_MILE
    if straight_mi > MAX_TRIP_MI:
        raise TripTooLongError(straight_mi)

    key = _cache_key(origin, target, trip)
    plan: RoutePlan | None = cache.get(key)
    if plan is None:
        plan = _build_plan(client, weather, origin, target, trip)
        cache.set(key, plan, PLAN_CACHE_S if plan.heatmap else PLAN_WITHOUT_HEATMAP_CACHE_S)
    return plan


def _build_plan(
    client: TomTomClient,
    weather: OpenMeteoClient,
    origin: Place,
    target: Place,
    trip: TripRequest,
) -> RoutePlan:
    options = find_route_options(
        client, origin.position, target.position, depart_at=trip.departure, load_lb=trip.load_lb
    )
    shortest_mi = min(option.route.length_m for option in options) / METERS_PER_MILE
    if shortest_mi > MAX_TRIP_MI:
        raise TripTooLongError(shortest_mi)
    named = list(zip(ROUTE_IDS, options, strict=False))
    checkpoints = [place_checkpoints(option.route, trip.interval_mi) for _, option in named]
    # The simplified lines are drawn on the map and also outline the heatmap's corridor, whose
    # cells are 20 km or more, so the full-detail routes are walked only once each.
    geometries = [tuple(simplify(option.route.points, GEOMETRY_TOLERANCE_M)) for _, option in named]

    # One weather lookup for the checkpoints of every route, then split back per route, while
    # the heatmap's weather is fetched alongside. If the checkpoints' lookup fails, the error is
    # returned at once; the heatmap's request finishes in the background and fills its cache.
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        heatmap_lookup = pool.submit(
            corridor_heatmap,
            weather,
            geometries,
            trip.departure,
            trip.load_lb,
        )
        forecasts = weather_at_stops(
            weather, [Stop(c.position, c.eta) for route in checkpoints for c in route]
        )
        heatmap = _heatmap(heatmap_lookup.result)
    finally:
        pool.shutdown(wait=False)
    routes = []
    start = 0
    for (route_id, option), geometry, route_checkpoints in zip(
        named, geometries, checkpoints, strict=True
    ):
        end = start + len(route_checkpoints)
        routes.append(
            _plan_route(
                route_id, option, geometry, route_checkpoints, forecasts[start:end], trip.load_lb
            )
        )
        start = end

    return RoutePlan(
        origin=origin,
        destination=target,
        load_lb=trip.load_lb,
        interval_mi=trip.interval_mi,
        routes=tuple(routes),
        recommendation=recommend([RankedRoute(r.route_id, r.duration_s, r.risk) for r in routes]),
        heatmap=heatmap,
    )


def _heatmap(result: Callable[[], Heatmap]) -> Heatmap | None:
    """The heatmap, or None if it could not be made: it is optional, the routes are not."""
    try:
        return result()
    except WeatherError as error:
        logger.warning("Heatmap skipped: %s", error)
    except Exception:
        logger.exception("Heatmap failed")
    return None


def _plan_route(
    route_id: str,
    option: RouteOption,
    geometry: tuple[LatLon, ...],
    checkpoints: list[Checkpoint],
    forecasts: Sequence[Weather],
    load_lb: int,
) -> PlannedRoute:
    route = option.route
    assessed = tuple(
        AssessedCheckpoint(checkpoint, weather, assess_checkpoint(weather.conditions, load_lb))
        for checkpoint, weather in zip(checkpoints, forecasts, strict=True)
    )
    return PlannedRoute(
        route_id=route_id,
        distance_m=route.length_m,
        duration_s=route.travel_time_s,
        traffic_delay_s=route.traffic_delay_s,
        departure=route.departure,
        arrival=route.arrival,
        detour=option.detour,
        geometry=geometry,
        checkpoints=assessed,
        risk=_route_risk(assessed),
    )


def _route_risk(checkpoints: Sequence[AssessedCheckpoint]) -> RouteRisk:
    """Miles at each level: every checkpoint stands for the road halfway to its neighbours."""
    distances_mi = [c.checkpoint.distance_m / METERS_PER_MILE for c in checkpoints]
    # The last checkpoint is the destination, so its distance is the route length.
    coverage = checkpoint_coverage(distances_mi, distances_mi[-1])
    return RouteRisk.from_segments(
        RiskSegment(miles, c.risk.level) for miles, c in zip(coverage, checkpoints, strict=True)
    )


def _cache_key(origin: Place, target: Place, trip: TripRequest) -> str:
    raw = "|".join(
        (
            f"{origin.position.lat:.5f},{origin.position.lon:.5f}",
            f"{target.position.lat:.5f},{target.position.lon:.5f}",
            trip.departure.isoformat(),
            str(trip.load_lb),
            str(trip.interval_mi),
        )
    )
    return "plan:" + hashlib.sha256(raw.encode()).hexdigest()
