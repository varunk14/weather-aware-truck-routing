"""Plans a trip: resolves the places, finds route options, places checkpoints.

Plans are cached for a few minutes, so reloading the same trip does not call TomTom again.
Only the simplified geometry is kept, which keeps cached plans small.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime

from django.core.cache import cache

from routing.clients.tomtom import Place, TomTomClient
from routing.geo import LatLon, haversine_m, simplify
from routing.services.checkpoints import Checkpoint, place_checkpoints
from routing.services.places import Location, resolve
from routing.services.route_options import RouteOption, find_route_options

GEOMETRY_TOLERANCE_M = 30
PLAN_CACHE_S = 15 * 60
MIN_TRIP_M = 1_000
ROUTE_IDS = ("A", "B", "C")


class SamePlaceError(ValueError):
    """The origin and destination resolve to (nearly) the same point."""


@dataclass(frozen=True, slots=True)
class TripRequest:
    origin: Location
    destination: Location
    departure: datetime
    load_lb: int
    interval_mi: int


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
    checkpoints: tuple[Checkpoint, ...]


@dataclass(frozen=True, slots=True)
class RoutePlan:
    origin: Place
    destination: Place
    load_lb: int
    interval_mi: int
    routes: tuple[PlannedRoute, ...]


def plan_trip(client: TomTomClient, trip: TripRequest) -> RoutePlan:
    origin = resolve(client, trip.origin)
    target = resolve(client, trip.destination)
    if haversine_m(origin.position, target.position) < MIN_TRIP_M:
        raise SamePlaceError("The origin and destination are the same place.")

    key = _cache_key(origin, target, trip)
    plan: RoutePlan | None = cache.get(key)
    if plan is None:
        options = find_route_options(
            client,
            origin.position,
            target.position,
            depart_at=trip.departure,
            load_lb=trip.load_lb,
        )
        plan = RoutePlan(
            origin=origin,
            destination=target,
            load_lb=trip.load_lb,
            interval_mi=trip.interval_mi,
            routes=tuple(
                _plan_route(route_id, option, trip.interval_mi)
                for route_id, option in zip(ROUTE_IDS, options, strict=False)
            ),
        )
        cache.set(key, plan, PLAN_CACHE_S)
    return plan


def _plan_route(route_id: str, option: RouteOption, interval_mi: int) -> PlannedRoute:
    route = option.route
    return PlannedRoute(
        route_id=route_id,
        distance_m=route.length_m,
        duration_s=route.travel_time_s,
        traffic_delay_s=route.traffic_delay_s,
        departure=route.departure,
        arrival=route.arrival,
        detour=option.detour,
        geometry=tuple(simplify(route.points, GEOMETRY_TOLERANCE_M)),
        checkpoints=tuple(place_checkpoints(route, interval_mi)),
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
