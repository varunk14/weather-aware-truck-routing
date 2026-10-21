"""Plans a trip: resolves the places, finds route options, places checkpoints, looks up the
weather at each checkpoint for the truck's arrival time, scores every route and recommends one.

Plans are cached for a few minutes, so reloading the same trip calls neither TomTom nor
Open-Meteo again. Only the simplified geometry is kept, which keeps cached plans small.
"""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from django.core.cache import cache

from routing.clients.open_meteo import OpenMeteoClient
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
from routing.services.places import Location, resolve
from routing.services.route_options import RouteOption, find_route_options
from routing.services.weather import Stop, Weather, weather_at_stops

GEOMETRY_TOLERANCE_M = 30
PLAN_CACHE_S = 15 * 60
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

    def rank(self, route_id: str) -> int:
        """1 for the recommended route, then upwards in ranking order."""
        ranked = [option.route_id for option in self.recommendation.ranked]
        return ranked.index(route_id) + 1


def plan_trip(client: TomTomClient, weather: OpenMeteoClient, trip: TripRequest) -> RoutePlan:
    origin = resolve(client, trip.origin)
    target = resolve(client, trip.destination)
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
        cache.set(key, plan, PLAN_CACHE_S)
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

    # One weather lookup for the checkpoints of every route, then split back per route.
    forecasts = weather_at_stops(
        weather, [Stop(c.position, c.eta) for route in checkpoints for c in route]
    )
    routes = []
    start = 0
    for (route_id, option), route_checkpoints in zip(named, checkpoints, strict=True):
        end = start + len(route_checkpoints)
        routes.append(
            _plan_route(route_id, option, route_checkpoints, forecasts[start:end], trip.load_lb)
        )
        start = end

    return RoutePlan(
        origin=origin,
        destination=target,
        load_lb=trip.load_lb,
        interval_mi=trip.interval_mi,
        routes=tuple(routes),
        recommendation=recommend([RankedRoute(r.route_id, r.duration_s, r.risk) for r in routes]),
    )


def _plan_route(
    route_id: str,
    option: RouteOption,
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
        geometry=tuple(simplify(route.points, GEOMETRY_TOLERANCE_M)),
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
