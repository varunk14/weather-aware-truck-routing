from datetime import datetime, timedelta
from typing import Any

import pytest
from django.test import Client
from django.utils import timezone

from routing import clients
from routing.clients.tomtom import TomTomNotConfiguredError
from routing.geo import LatLon
from routing.throttles import RoutesThrottle, SuggestThrottle
from tests.routing.conftest import (
    CALM,
    FakeOpenMeteo,
    FakeTomTom,
    WeatherValues,
    load,
    load_open_meteo,
)

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
        assert set(first) == {"index", "mile", "lat", "lon", "eta", "weather", "risk"}
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


def storm_on_interstate_94(point: LatLon, hour: datetime) -> WeatherValues:
    """Severe rain (0.4 in/hr rain + 0.2 in/hr showers) over I-94 between Chicago and Milwaukee.

    Routes A and B follow I-94; Route C swings west through Rockford and stays out of it.
    """
    if 42.2 <= point.lat <= 42.9 and point.lon > -88.0:
        return {**CALM, "rain": 0.4, "showers": 0.2}
    return CALM


def wind(mph: float) -> Any:
    return lambda point, hour: {**CALM, "wind_speed_10m": mph}


class TestWeatherRisk:
    def test_calm_weather_recommends_the_fastest_route(
        self, client: Client, api_tomtom: FakeTomTom
    ) -> None:
        body = post(client, trip()).json()

        assert body["recommendation"] == {
            "route_id": "A",
            "reason": "Fastest route, and no other route has less weather risk.",
            "safe": True,
        }
        assert [r["rank"] for r in body["routes"]] == [1, 2, 3]
        route = body["routes"][0]
        assert route["risk"] == {
            "miles": {"low": 90.3, "moderate": 0, "high": 0, "severe": 0, "no_travel": 0},
            "average": 0,
            "worst": "low",
        }
        first = route["checkpoints"][0]
        assert first["weather"] == {
            "wind_mph": 6.0,
            "gust_mph": 11.0,
            "rain_in_hr": 0,
            "snow_in_hr": 0,
        }
        assert first["risk"] == {
            "level": "low",
            "score": 0,
            "wind": "low",
            "rain": "low",
            "snow": "low",
            "causes": [],
        }

    def test_a_storm_on_the_direct_routes_recommends_the_dry_detour(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.weather = storm_on_interstate_94

        body = post(client, trip()).json()

        routes = {r["id"]: r for r in body["routes"]}
        assert body["recommendation"]["route_id"] == "C"
        assert body["recommendation"]["safe"] is True
        assert body["recommendation"]["reason"].startswith("Avoids ")
        assert (
            "of Severe weather on the fastest route (Route A)" in body["recommendation"]["reason"]
        )
        assert routes["C"]["rank"] == 1
        assert routes["A"]["risk"]["miles"]["severe"] > 0
        assert routes["B"]["risk"]["miles"]["severe"] > 0
        assert routes["C"]["risk"]["miles"]["severe"] == 0
        stormy = [c for c in routes["A"]["checkpoints"] if c["risk"]["level"] == "severe"]
        assert stormy
        assert stormy[0]["weather"]["rain_in_hr"] == 0.6
        assert stormy[0]["risk"]["causes"] == ["rain"]

    @pytest.mark.parametrize(
        ("load_lb", "level", "causes"),
        [(38_000, "high", ["wind"]), (42_000, "severe", ["wind", "load"])],
    )
    def test_heavy_loads_raise_the_wind_risk(
        self,
        client: Client,
        api_tomtom: FakeTomTom,
        open_meteo: FakeOpenMeteo,
        load_lb: int,
        level: str,
        causes: list[str],
    ) -> None:
        open_meteo.weather = wind(40)

        body = post(client, trip(load_lb=load_lb)).json()

        checkpoint = body["routes"][0]["checkpoints"][1]
        assert checkpoint["risk"]["level"] == level
        assert checkpoint["risk"]["causes"] == causes
        assert body["routes"][0]["risk"]["worst"] == level

    def test_no_travel_on_every_route_is_flagged(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.weather = wind(60)

        recommendation = post(client, trip()).json()["recommendation"]

        assert recommendation["safe"] is False
        assert recommendation["reason"].startswith("Every route crosses No Travel conditions.")

    def test_one_weather_lookup_covers_every_route(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        body = post(client, trip()).json()

        checkpoints = sum(len(r["checkpoints"]) for r in body["routes"])
        assert len(open_meteo.requests) == 1
        # The shared origin and destination are fetched once, not once per route.
        assert open_meteo.points_requested() < checkpoints

    def test_the_forecast_window_follows_the_arrival_times(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        post(client, trip())

        # Departure 13:00 -05:00 and the last arrival 16:02 -05:00, padded by two hours.
        params = open_meteo.requests[0].url.params
        assert params["start_hour"] == "2026-10-21T16:00"
        assert params["end_hour"] == "2026-10-22T00:00"

    def test_weather_is_cached_with_the_plan(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        body = trip()
        post(client, body)
        post(client, body)

        assert len(open_meteo.requests) == 1


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

    def test_weather_unavailable(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.respond(429, {"error": True, "reason": "Too many requests"})

        response = post(client, trip())

        assert response.status_code == 503
        assert response.json() == {
            "detail": "The weather service is not responding. Try again in a moment."
        }

    def test_weather_request_rejected(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.respond(400, load_open_meteo("error_out_of_range"))

        response = post(client, trip())

        assert response.status_code == 502
        assert response.json() == {"detail": "The weather service returned an unexpected response."}

    def test_incomplete_forecast(
        self, client: Client, api_tomtom: FakeTomTom, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.weather = lambda point, hour: {**CALM, "snowfall": None}

        response = post(client, trip())

        assert response.status_code == 502
        assert "incomplete" in response.json()["detail"]


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
