"""Fake TomTom and Open-Meteo services, so routing tests never hit the network.

The fixtures in ``tests/fixtures/tomtom`` are real TomTom responses (Chicago to Milwaukee),
recorded once and stored without the API key. The fake Open-Meteo builds responses in the
recorded format (``tests/fixtures/open_meteo``) for whatever points and hours are asked, from
a weather function each test can replace.
"""

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from django.core.cache import cache

from routing import clients
from routing.clients.open_meteo import HOURLY_UNITS, OpenMeteoClient
from routing.clients.tomtom import TomTomClient
from routing.geo import LatLon

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "tomtom"
OPEN_METEO_FIXTURES = FIXTURES.parent / "open_meteo"
TEST_KEY = "test-key"
HOUR_FORMAT = "%Y-%m-%dT%H:%M"

Handler = Callable[[httpx.Request], httpx.Response]
WeatherValues = Mapping[str, float | None]
WeatherFunction = Callable[[LatLon, datetime], WeatherValues]

CALM: WeatherValues = {
    "wind_speed_10m": 6.0,
    "wind_gusts_10m": 11.0,
    "rain": 0.0,
    "showers": 0.0,
    "snowfall": 0.0,
}


def load(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def load_open_meteo(name: str) -> Any:
    return json.loads((OPEN_METEO_FIXTURES / f"{name}.json").read_text())


class FakeOpenMeteo:
    """Answers forecast requests from ``weather(point, hour)`` and records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.weather: WeatherFunction = lambda point, hour: CALM
        self.override: Handler | None = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.override is not None:
            return self.override(request)
        params = request.url.params
        points = [
            LatLon(float(lat), float(lon))
            for lat, lon in zip(
                params["latitude"].split(","), params["longitude"].split(","), strict=True
            )
        ]
        start = datetime.strptime(params["start_hour"], HOUR_FORMAT).replace(tzinfo=UTC)
        end = datetime.strptime(params["end_hour"], HOUR_FORMAT).replace(tzinfo=UTC)
        hours = [start + timedelta(hours=i) for i in range((end - start) // timedelta(hours=1) + 1)]
        items = [self._forecast(point, hours) for point in points]
        return httpx.Response(200, json=items[0] if len(items) == 1 else items)

    def _forecast(self, point: LatLon, hours: list[datetime]) -> dict[str, Any]:
        values = [self.weather(point, hour) for hour in hours]
        return {
            "latitude": point.lat,
            "longitude": point.lon,
            "hourly_units": {"time": "iso8601", **HOURLY_UNITS},
            "hourly": {
                "time": [hour.strftime(HOUR_FORMAT) for hour in hours],
                **{name: [v[name] for v in values] for name in HOURLY_UNITS},
            },
        }

    def respond(self, status: int = 200, body: Any = None) -> None:
        self.override = lambda request: httpx.Response(status, json=body)

    def points_requested(self) -> int:
        return sum(len(r.url.params["latitude"].split(",")) for r in self.requests)

    def client(self, **kwargs: Any) -> OpenMeteoClient:
        return OpenMeteoClient(transport=httpx.MockTransport(self.handle), **kwargs)


class FakeTomTom:
    """Serves recorded responses by request kind and records every request it receives."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.overrides: dict[str, Handler] = {}

    def kind(self, request: httpx.Request) -> str:
        path = request.url.path
        if path.endswith("/places/suggest"):
            return "suggest"
        if "/places/details/" in path:
            return "details"
        if path.startswith("/search/2/geocode/"):
            return "geocode"
        if path.startswith("/routing/1/calculateRoute/"):
            locations = path.removeprefix("/routing/1/calculateRoute/").split("/")[0]
            return "via_route" if locations.count(":") >= 2 else "route"
        raise AssertionError(f"Unexpected TomTom request: {request.method} {path}")

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        kind = self.kind(request)
        if kind in self.overrides:
            return self.overrides[kind](request)
        fixture = {
            "suggest": "suggest_milwaukee",
            "details": "details_milwaukee",
            "geocode": "geocode_milwaukee",
            "route": "route_chicago_milwaukee",
            "via_route": "route_via_point",
        }[kind]
        return httpx.Response(200, json=load(fixture))

    def count(self, kind: str) -> int:
        return sum(1 for request in self.requests if self.kind(request) == kind)

    def respond(self, kind: str, status: int = 200, body: Any = None) -> None:
        self.overrides[kind] = lambda request: httpx.Response(status, json=body)

    def client(self, **kwargs: Any) -> TomTomClient:
        return TomTomClient(TEST_KEY, transport=httpx.MockTransport(self.handle), **kwargs)


@pytest.fixture(autouse=True)
def _clear_cache() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def tomtom() -> FakeTomTom:
    return FakeTomTom()


@pytest.fixture
def open_meteo() -> FakeOpenMeteo:
    return FakeOpenMeteo()


@pytest.fixture(autouse=True)
def _fake_open_meteo(open_meteo: FakeOpenMeteo, monkeypatch: pytest.MonkeyPatch) -> None:
    """Every routing test plans against the fake Open-Meteo (calm weather unless changed)."""
    client = open_meteo.client()
    monkeypatch.setattr(clients, "open_meteo_client", lambda: client)


@pytest.fixture
def api_tomtom(tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch) -> FakeTomTom:
    """A fake TomTom wired into the API views."""
    client = tomtom.client()
    monkeypatch.setattr(clients, "tomtom_client", lambda: client)
    return tomtom
