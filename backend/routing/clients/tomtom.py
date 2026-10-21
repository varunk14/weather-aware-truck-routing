"""Client for the TomTom APIs Clearway uses: place suggestions, place details, geocoding and
truck routing.

Places requests carry the key in a header. Geocoding and routing only accept it as a query
parameter, so the key must never reach logs or error messages: httpx request logging is turned
down in settings, and errors are built from TomTom's response body, never from the request URL.
"""

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import quote

import httpx

from routing.geo import LatLon

logger = logging.getLogger(__name__)

BASE_URL = "https://api.tomtom.com"
PLACES_API_VERSION = "3"
KG_PER_LB = 0.45359237

_PLACE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_PLACE_TYPE = re.compile(r"[a-z]{1,32}")


class TomTomError(Exception):
    """TomTom returned an error or a response Clearway cannot use."""


class TomTomNotConfiguredError(TomTomError):
    """No API key is configured."""


class TomTomUnavailableError(TomTomError):
    """TomTom timed out, failed, or is rate limiting requests."""


class PlaceNotFoundError(TomTomError):
    """The place id or address does not resolve to a location."""


class NoRouteFoundError(TomTomError):
    """TomTom found no truck route between the locations."""


@dataclass(frozen=True, slots=True)
class Suggestion:
    id: str
    type: str
    title: str
    subtitle: str


@dataclass(frozen=True, slots=True)
class Place:
    title: str
    position: LatLon


@dataclass(frozen=True, slots=True)
class ProgressPoint:
    point_index: int
    distance_m: float
    travel_time_s: float


@dataclass(frozen=True, slots=True)
class TruckRoute:
    """A route as returned by TomTom, with all legs joined into one polyline."""

    points: tuple[LatLon, ...]
    progress: tuple[ProgressPoint, ...]
    length_m: float
    travel_time_s: float
    traffic_delay_s: float
    departure: datetime
    arrival: datetime


class TomTomClient:
    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout_s: float = 20.0,
        retries: int = 1,
    ) -> None:
        if not api_key:
            raise TomTomNotConfiguredError("TOMTOM_API_KEY is not set.")
        self._key = api_key
        self._retries = retries
        self._http = httpx.Client(
            base_url=BASE_URL,
            transport=transport,
            timeout=httpx.Timeout(timeout_s, connect=5.0),
            headers={"Accept": "application/json"},
        )

    def suggest(self, query: str, *, limit: int = 5) -> list[Suggestion]:
        data = self._request(
            "POST",
            "/maps/orbis/places/suggest",
            headers=self._places_headers("results"),
            json={"query": query, "maxResults": limit},
        )
        suggestions = []
        for item in data.get("results", []):
            more = item.get("more", {}).get("pathParameters", [])
            path = {p["parameter"]: p["argument"] for p in more}
            if "type" not in path or "id" not in item:
                continue
            suggestions.append(
                Suggestion(
                    id=item["id"],
                    type=path["type"],
                    title=item.get("title", ""),
                    subtitle=", ".join(item.get("subtitles", [])),
                )
            )
        return suggestions

    def place(self, place_type: str, place_id: str) -> Place:
        if not _PLACE_TYPE.fullmatch(place_type) or not _PLACE_ID.fullmatch(place_id):
            raise PlaceNotFoundError("The place reference is not valid.")
        data = self._request(
            "GET",
            f"/maps/orbis/places/details/{place_type}/{place_id}",
            headers=self._places_headers("id,type,title,subtitles,position"),
            not_found=PlaceNotFoundError,
        )
        try:
            lon, lat = data["position"]["coordinates"]
            return Place(title=data["title"], position=LatLon(lat, lon))
        except (KeyError, TypeError, ValueError) as error:
            raise TomTomError("TomTom returned a place without a position.") from error

    def geocode(self, query: str) -> Place:
        data = self._request(
            "GET",
            f"/search/2/geocode/{quote(query, safe='')}.json",
            params={"limit": 1, "key": self._key},
        )
        results = data.get("results") or []
        if not results:
            raise PlaceNotFoundError(f"No place matches {query!r}.")
        try:
            first = results[0]
            title = first.get("address", {}).get("freeformAddress") or query
            position = LatLon(first["position"]["lat"], first["position"]["lon"])
        except (KeyError, TypeError) as error:
            raise TomTomError("TomTom returned a geocoding result without a position.") from error
        return Place(title=title, position=position)

    def truck_routes(
        self,
        locations: Sequence[LatLon],
        *,
        depart_at: datetime,
        load_lb: float,
        alternatives: int = 0,
    ) -> list[TruckRoute]:
        """Truck routes through ``locations`` (origin, optional via points, destination)."""
        path = ":".join(f"{p.lat:.6f},{p.lon:.6f}" for p in locations)
        params: list[tuple[str, str | int]] = [
            ("travelMode", "truck"),
            ("vehicleWeight", round(load_lb * KG_PER_LB)),
            ("vehicleCommercial", "true"),
            ("routeRepresentation", "polyline"),
            ("extendedRouteRepresentation", "distance"),
            ("extendedRouteRepresentation", "travelTime"),
            ("computeTravelTimeFor", "none"),
            ("departAt", depart_at.isoformat(timespec="seconds")),
            ("key", self._key),
        ]
        if alternatives:
            params += [("maxAlternatives", alternatives), ("alternativeType", "anyRoute")]
        data = self._request(
            "GET", f"/routing/1/calculateRoute/{path}/json", params=params, no_route=True
        )
        try:
            return [_parse_route(route) for route in data.get("routes", [])]
        except (KeyError, TypeError, ValueError) as error:
            raise TomTomError("TomTom returned a route Clearway could not read.") from error

    def close(self) -> None:
        self._http.close()

    def _places_headers(self, attributes: str) -> dict[str, str]:
        return {
            "TomTom-Api-Key": self._key,
            "TomTom-Api-Version": PLACES_API_VERSION,
            "Attributes": attributes,
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Any = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
        not_found: type[TomTomError] | None = None,
        no_route: bool = False,
    ) -> dict[str, Any]:
        response = self._send(method, path, params=params, json=json, headers=headers)
        status = response.status_code
        code, message = _error_details(response)

        if status == 404 and not_found is not None:
            raise not_found(message or "Not found.")
        if no_route and code == "NO_ROUTE_FOUND":
            raise NoRouteFoundError(message or "No route found.")
        if status in (401, 403):
            raise TomTomError(
                "TomTom rejected the API key, or the key does not include this product."
            )
        if not response.is_success:
            raise TomTomError(f"TomTom returned HTTP {status} ({code or 'no error code'}).")
        try:
            body = response.json()
        except ValueError as error:
            raise TomTomError("TomTom returned a response that is not JSON.") from error
        if not isinstance(body, dict):
            raise TomTomError("TomTom returned an unexpected response.")
        return body

    def _send(
        self,
        method: str,
        path: str,
        *,
        params: Any,
        json: Any,
        headers: dict[str, str] | None,
    ) -> httpx.Response:
        for attempt in range(self._retries + 1):
            try:
                response = self._http.request(
                    method, path, params=params, json=json, headers=headers
                )
            except httpx.RequestError as error:
                # The path never contains the key; the query string is not logged.
                logger.warning("TomTom %s %s failed: %s", method, path, type(error).__name__)
            else:
                if response.status_code == 429:
                    raise TomTomUnavailableError("TomTom is rate limiting requests.")
                if response.status_code < 500:
                    return response
                logger.warning("TomTom %s %s returned %s", method, path, response.status_code)
            if attempt == self._retries:
                break
        raise TomTomUnavailableError("TomTom did not respond. Try again in a moment.")


def _error_details(response: httpx.Response) -> tuple[str, str]:
    if response.is_success:
        return "", ""
    try:
        details = response.json().get("detailedError", {})
        return str(details.get("code", "")), str(details.get("message", ""))
    except (ValueError, AttributeError):
        return "", ""


def _parse_route(data: dict[str, Any]) -> TruckRoute:
    summary = data["summary"]
    return TruckRoute(
        points=tuple(
            LatLon(point["latitude"], point["longitude"])
            for leg in data["legs"]
            for point in leg["points"]
        ),
        progress=tuple(
            ProgressPoint(p["pointIndex"], p["distanceInMeters"], p["travelTimeInSeconds"])
            for p in data["progress"]
        ),
        length_m=summary["lengthInMeters"],
        travel_time_s=summary["travelTimeInSeconds"],
        traffic_delay_s=summary.get("trafficDelayInSeconds", 0),
        departure=datetime.fromisoformat(summary["departureTime"]),
        arrival=datetime.fromisoformat(summary["arrivalTime"]),
    )
