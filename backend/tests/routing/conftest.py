"""A fake TomTom that answers with recorded responses, so routing tests never hit the network.

The fixtures in ``tests/fixtures/tomtom`` are real TomTom responses (Chicago to Milwaukee),
recorded once and stored without the API key.
"""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from django.core.cache import cache

from routing import clients
from routing.clients.tomtom import TomTomClient

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "tomtom"
TEST_KEY = "test-key"

Handler = Callable[[httpx.Request], httpx.Response]


def load(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text())


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
def api_tomtom(tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch) -> FakeTomTom:
    """A fake TomTom wired into the API views."""
    client = tomtom.client()
    monkeypatch.setattr(clients, "tomtom_client", lambda: client)
    return tomtom
