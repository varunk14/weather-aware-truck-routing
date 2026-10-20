from datetime import datetime, timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from routing import clients
from routing.clients.tomtom import TomTomNotConfiguredError
from routing.throttles import RoutesThrottle, SuggestThrottle
from tests.routing.conftest import FakeTomTom, load

CHICAGO = {"lat": 41.8781, "lon": -87.6298}
MILWAUKEE = {"lat": 43.0389, "lon": -87.9065}


def departure(**delta: float) -> str:
    return (timezone.now() + timedelta(**delta or {"days": 1})).isoformat()


def trip(**overrides: Any) -> dict[str, Any]:
    return {
        "origin": CHICAGO,
        "destination": MILWAUKEE,
        "departure": departure(),
        "load_lb": 38_000,
        "interval_mi": 25,
        **overrides,
    }


def post(client: Client, body: dict[str, Any]) -> Any:
    return client.post("/api/routes", data=body, content_type="application/json")


class TestSuggest:
    def test_returns_suggestions(self, client: Client, api_tomtom: FakeTomTom) -> None:
        response = client.get("/api/places/suggest", {"q": "milwau"})

        assert response.status_code == 200
        first = response.json()["results"][0]
        assert first == {
            "id": "FQ7v-lMA6etQH3Bm9hQ7uw",
            "type": "areas",
            "title": "Milwaukee, WI",
            "subtitle": "United States",
        }

    def test_short_queries_return_nothing_without_calling_tomtom(
        self, client: Client, api_tomtom: FakeTomTom
    ) -> None:
        assert client.get("/api/places/suggest", {"q": " m "}).json() == {"results": []}
        assert api_tomtom.requests == []

    def test_long_queries_are_rejected(self, client: Client, api_tomtom: FakeTomTom) -> None:
        response = client.get("/api/places/suggest", {"q": "x" * 101})

        assert response.status_code == 400
        assert "q" in response.json()

    def test_repeated_queries_are_served_from_the_cache(
        self, client: Client, api_tomtom: FakeTomTom
    ) -> None:
        client.get("/api/places/suggest", {"q": "milwau"})
        client.get("/api/places/suggest", {"q": "MILWAU"})

        assert api_tomtom.count("suggest") == 1


class TestRoutes:
    def test_plans_three_routes_with_checkpoints(
        self, client: Client, api_tomtom: FakeTomTom
    ) -> None:
        response = post(client, trip())

        assert response.status_code == 200
        body = response.json()
        assert body["origin"] == {"title": "41.8781, -87.6298", **CHICAGO}
        assert body["load_lb"] == 38_000
        assert body["notes"] == []
        assert [r["id"] for r in body["routes"]] == ["A", "B", "C"]

        route = body["routes"][0]
        assert route["distance_mi"] == 90.3
        assert route["duration_s"] == 6_187
        assert route["detour"] is False
        assert route["geometry"]["type"] == "LineString"
        assert 50 < len(route["geometry"]["coordinates"]) < 2_040
        assert [c["mile"] for c in route["checkpoints"]] == [0, 25, 50, 75, 90.3]
        first = route["checkpoints"][0]
        assert set(first) == {"index", "mile", "lat", "lon", "eta"}
        assert datetime.fromisoformat(first["eta"]) == datetime.fromisoformat(route["departure"])

    def test_resolves_picked_suggestions(self, client: Client, api_tomtom: FakeTomTom) -> None:
        picked = {"place_id": "FQ7v-lMA6etQH3Bm9hQ7uw", "place_type": "areas"}

        response = post(client, trip(destination=picked))

        assert response.status_code == 200
        assert response.json()["destination"]["title"] == "Milwaukee, WI"
        assert api_tomtom.count("details") == 1

    def test_geocodes_free_text(self, client: Client, api_tomtom: FakeTomTom) -> None:
        response = post(client, trip(destination={"query": "Milwaukee, WI"}))

        assert response.status_code == 200
        assert api_tomtom.count("geocode") == 1

    def test_repeated_trips_are_served_from_the_cache(
        self, client: Client, api_tomtom: FakeTomTom
    ) -> None:
        body = trip()
        post(client, body)
        post(client, body)

        assert api_tomtom.count("route") == 1

    def test_reports_detours_in_the_notes(self, client: Client, api_tomtom: FakeTomTom) -> None:
        recorded = load("route_chicago_milwaukee")
        api_tomtom.respond("route", body={**recorded, "routes": recorded["routes"][:1]})

        body = post(client, trip()).json()

        assert [r["detour"] for r in body["routes"]] == [False, True]
        assert body["notes"] == [
            "Only 2 distinct truck routes connect these places.",
            "Route B came from routing through a point beside the main route, "
            "because fewer direct alternatives were available.",
        ]

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"load_lb": 0}, "load_lb"),
            ({"load_lb": 80_001}, "load_lb"),
            ({"interval_mi": 30}, "interval_mi"),
            ({"departure": "not a date"}, "departure"),
            ({"origin": {"query": "Chicago", "lat": 1, "lon": 2}}, "origin"),
            ({"origin": {"lat": 41.9}}, "origin"),
            ({"origin": {"place_id": "abc"}}, "origin"),
            ({"origin": {"lat": 91, "lon": 0}}, "origin"),
            ({"origin": {}}, "origin"),
            ({"destination": CHICAGO}, "destination"),
        ],
    )
    def test_rejects_invalid_trips(
        self, client: Client, api_tomtom: FakeTomTom, overrides: dict[str, Any], field: str
    ) -> None:
        response = post(client, trip(**overrides))

        assert response.status_code == 400
        assert field in response.json()

    @pytest.mark.parametrize(("delta", "message"), [({"hours": -2}, "now"), ({"days": 8}, "7")])
    def test_departure_must_be_within_the_forecast_window(
        self, client: Client, api_tomtom: FakeTomTom, delta: dict[str, float], message: str
    ) -> None:
        response = post(client, trip(departure=departure(**delta)))

        assert response.status_code == 400
        assert message in response.json()["departure"][0]

    def test_a_departure_a_few_minutes_ago_is_accepted(
        self, client: Client, api_tomtom: FakeTomTom
    ) -> None:
        assert post(client, trip(departure=departure(minutes=-5))).status_code == 200


class TestErrors:
    def test_no_truck_route(self, client: Client, api_tomtom: FakeTomTom) -> None:
        api_tomtom.respond("route", 400, load("route_no_route"))

        response = post(client, trip())

        assert response.status_code == 422
        assert response.json() == {"detail": "No truck route connects these places."}

    def test_unknown_place(self, client: Client, api_tomtom: FakeTomTom) -> None:
        api_tomtom.respond("geocode", body={"results": []})

        response = post(client, trip(origin={"query": "Nowhere"}))

        assert response.status_code == 422
        assert "could not be found" in response.json()["detail"]

    def test_tomtom_unavailable(self, client: Client, api_tomtom: FakeTomTom) -> None:
        api_tomtom.respond("route", 503)

        response = post(client, trip())

        assert response.status_code == 503
        assert "not responding" in response.json()["detail"]

    def test_unexpected_tomtom_response(self, client: Client, api_tomtom: FakeTomTom) -> None:
        api_tomtom.respond("route", body={"routes": [{"summary": {}}]})

        assert post(client, trip()).status_code == 502

    def test_missing_api_key(self, client: Client, monkeypatch: pytest.MonkeyPatch) -> None:
        def not_configured() -> None:
            raise TomTomNotConfiguredError("TOMTOM_API_KEY is not set.")

        monkeypatch.setattr(clients, "tomtom_client", not_configured)

        response = client.get("/api/places/suggest", {"q": "milwau"})

        assert response.status_code == 503
        assert response.json() == {"detail": "Routing is not configured on the server."}


class TestRateLimits:
    def test_suggestions_are_rate_limited(
        self, client: Client, api_tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(SuggestThrottle, "THROTTLE_RATES", {"suggest": "2/min"})

        codes = [client.get("/api/places/suggest", {"q": "milwau"}).status_code for _ in range(3)]

        assert codes == [200, 200, 429]

    def test_route_planning_is_rate_limited(
        self, client: Client, api_tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(RoutesThrottle, "THROTTLE_RATES", {"routes": "1/min"})

        codes = [post(client, trip()).status_code for _ in range(2)]

        assert codes == [200, 429]

    def test_health_is_never_rate_limited(self, client: Client) -> None:
        assert all(client.get("/api/health").status_code == 200 for _ in range(30))
