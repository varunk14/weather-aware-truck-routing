"""Request validation and response shapes for the trip planning API."""

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from routing.clients.tomtom import Place
from routing.geo import METERS_PER_MILE
from routing.risk import RiskLevel, RouteRisk
from routing.services.heatmap import FRAME_COUNT, Heatmap
from routing.services.places import Address, Coordinates, Location, PlaceRef
from routing.services.planner import (
    ROUTE_IDS,
    AssessedCheckpoint,
    PlannedRoute,
    RoutePlan,
    TripRequest,
)

INTERVALS_MI = (10, 25, 50)
DEFAULT_INTERVAL_MI = 25
MAX_LOAD_LB = 80_000
# Open-Meteo forecasts 16 days ahead. Ten days leaves room for the longest trip (3,500 miles,
# about three days of driving) and the 48 hour heatmap inside the forecast.
MAX_DAYS_AHEAD = 10
# A departure a few minutes in the past is accepted, so "leave now" survives a slow form.
DEPARTURE_GRACE = timedelta(minutes=15)


class LocationSerializer(serializers.Serializer[Any]):
    """One of: a picked suggestion, coordinates, or free text."""

    place_id = serializers.CharField(required=False, max_length=64)
    place_type = serializers.CharField(required=False, max_length=32)
    lat = serializers.FloatField(required=False, min_value=-90, max_value=90)
    lon = serializers.FloatField(required=False, min_value=-180, max_value=180)
    query = serializers.CharField(required=False, max_length=200)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        has_place = "place_id" in attrs or "place_type" in attrs
        has_coordinates = "lat" in attrs or "lon" in attrs
        has_query = "query" in attrs
        if has_place + has_coordinates + has_query != 1:
            raise serializers.ValidationError(
                "Give exactly one of: place_id with place_type, lat with lon, or query."
            )
        if has_place and not {"place_id", "place_type"} <= attrs.keys():
            raise serializers.ValidationError("place_id and place_type must be given together.")
        if has_coordinates and not {"lat", "lon"} <= attrs.keys():
            raise serializers.ValidationError("lat and lon must be given together.")
        return attrs


def to_location(attrs: dict[str, Any]) -> Location:
    if "place_id" in attrs:
        return PlaceRef(type=attrs["place_type"], id=attrs["place_id"])
    if "lat" in attrs:
        return Coordinates(lat=attrs["lat"], lon=attrs["lon"])
    return Address(text=attrs["query"])


class TripRequestSerializer(serializers.Serializer[Any]):
    origin = LocationSerializer()
    destination = LocationSerializer()
    departure = serializers.DateTimeField()
    load_lb = serializers.IntegerField(min_value=1, max_value=MAX_LOAD_LB)
    interval_mi = serializers.ChoiceField(choices=INTERVALS_MI, default=DEFAULT_INTERVAL_MI)

    def validate_departure(self, value: datetime) -> datetime:
        now = timezone.now()
        if value < now - DEPARTURE_GRACE:
            raise serializers.ValidationError("Departure must be now or later.")
        if value > now + timedelta(days=MAX_DAYS_AHEAD):
            raise serializers.ValidationError(
                f"Departure must be within the next {MAX_DAYS_AHEAD} days."
            )
        return value

    def to_trip(self) -> TripRequest:
        data = self.validated_data
        return TripRequest(
            origin=to_location(data["origin"]),
            destination=to_location(data["destination"]),
            departure=data["departure"],
            load_lb=data["load_lb"],
            interval_mi=int(data["interval_mi"]),
        )


def plan_to_json(plan: RoutePlan) -> dict[str, Any]:
    return {
        "origin": _place_json(plan.origin),
        "destination": _place_json(plan.destination),
        "load_lb": plan.load_lb,
        "interval_mi": plan.interval_mi,
        "routes": [_route_json(route, plan.rank(route.route_id)) for route in plan.routes],
        "recommendation": {
            "route_id": plan.recommendation.best.route_id,
            "reason": plan.recommendation.reason,
            "safe": plan.recommendation.is_safe,
        },
        "notes": _notes(plan),
        "heatmap": _heatmap_json(plan.heatmap) if plan.heatmap else None,
    }


def _heatmap_json(heatmap: Heatmap) -> dict[str, Any]:
    """Hourly frames per cell as plain lists, which keeps 240 cells x 50 hours compact."""
    return {
        "start": heatmap.start.isoformat(),
        "frames": FRAME_COUNT,
        "spacing_m": round(heatmap.spacing_m),
        "cell_size": {"lat": round(heatmap.lat_step, 5), "lon": round(heatmap.lon_step, 5)},
        "cells": [
            {
                "lat": round(cell.position.lat, 4),
                "lon": round(cell.position.lon, 4),
                "risk": [None if level is None else int(level) for level in cell.risk],
                "wind": _rounded(cell.wind_mph, 1),
                "rain": _rounded(cell.rain_in_per_hr, 3),
                "snow": _rounded(cell.snow_in_per_hr, 3),
            }
            for cell in heatmap.cells
        ],
    }


def _rounded(values: Sequence[float | None], digits: int) -> list[float | None]:
    return [None if value is None else round(value, digits) for value in values]


def _place_json(place: Place) -> dict[str, Any]:
    return {
        "title": place.title,
        "lat": round(place.position.lat, 5),
        "lon": round(place.position.lon, 5),
    }


def _route_json(route: PlannedRoute, rank: int) -> dict[str, Any]:
    return {
        "id": route.route_id,
        "rank": rank,
        "distance_mi": round(route.distance_m / METERS_PER_MILE, 1),
        "duration_s": round(route.duration_s),
        "traffic_delay_s": round(route.traffic_delay_s),
        "departure": route.departure.isoformat(),
        "arrival": route.arrival.isoformat(),
        "detour": route.detour,
        "geometry": {
            "type": "LineString",
            "coordinates": [[round(p.lon, 5), round(p.lat, 5)] for p in route.geometry],
        },
        "risk": _route_risk_json(route.risk),
        "checkpoints": [
            _checkpoint_json(index, checkpoint)
            for index, checkpoint in enumerate(route.checkpoints)
        ],
    }


def _route_risk_json(risk: RouteRisk) -> dict[str, Any]:
    return {
        "miles": {_level_key(level): round(risk.miles(level), 1) for level in RiskLevel},
        "average": round(risk.average_risk, 3),
        "worst": _level_key(risk.worst_level),
    }


def _checkpoint_json(index: int, assessed: AssessedCheckpoint) -> dict[str, Any]:
    checkpoint, weather, risk = assessed.checkpoint, assessed.weather, assessed.risk
    return {
        "index": index,
        "mile": round(checkpoint.distance_m / METERS_PER_MILE, 1),
        "lat": round(checkpoint.position.lat, 5),
        "lon": round(checkpoint.position.lon, 5),
        "eta": checkpoint.eta.isoformat(timespec="seconds"),
        "weather": {
            "wind_mph": round(weather.wind_mph, 1),
            "gust_mph": round(weather.gust_mph, 1),
            "rain_in_hr": round(weather.rain_in_per_hr, 3),
            "snow_in_hr": round(weather.snow_in_per_hr, 3),
        },
        "risk": {
            "level": _level_key(risk.level),
            "score": int(risk.level),
            "wind": _level_key(risk.wind),
            "rain": _level_key(risk.rain),
            "snow": _level_key(risk.snow),
            "causes": list(risk.causes),
        },
    }


def _level_key(level: RiskLevel) -> str:
    """Stable machine name of a level: low, moderate, high, severe, no_travel."""
    return level.name.lower()


def _notes(plan: RoutePlan) -> list[str]:
    notes = []
    if len(plan.routes) < len(ROUTE_IDS):
        notes.append(
            f"Only {len(plan.routes)} distinct truck routes were found between these places."
        )
    detours = [route.route_id for route in plan.routes if route.detour]
    if detours:
        names = " and ".join(f"Route {route_id}" for route_id in detours)
        one = len(detours) == 1
        notes.append(
            f"{names} {'goes' if one else 'go'} through a point beside Route "
            f"{plan.routes[0].route_id}, so {'it uses' if one else 'they use'} different roads."
        )
    return notes
