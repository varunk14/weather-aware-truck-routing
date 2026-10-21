import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from routing import clients
from routing.clients.tomtom import (
    NoRouteFoundError,
    PlaceNotFoundError,
    TomTomClient,
    TomTomError,
    TomTomNotConfiguredError,
    TomTomUnavailableError,
)
from routing.geo import LatLon
from tests.routing.conftest import TEST_KEY, FakeTomTom, load

CHICAGO = LatLon(41.8781, -87.6298)
MILWAUKEE = LatLon(43.0389, -87.9065)
DEPART = datetime(2026, 10, 21, 18, tzinfo=UTC)


def test_requires_an_api_key() -> None:
    with pytest.raises(TomTomNotConfiguredError):
        TomTomClient("")


def test_the_shared_client_uses_the_configured_key() -> None:
    clients.tomtom_client.cache_clear()
    try:
        assert isinstance(clients.tomtom_client(), TomTomClient)
        assert clients.tomtom_client() is clients.tomtom_client()
    finally:
        clients.tomtom_client.cache_clear()


class TestSuggest:
    def test_parses_suggestions(self, tomtom: FakeTomTom) -> None:
        suggestions = tomtom.client().suggest("milwau")

        assert [s.title for s in suggestions][:2] == ["Milwaukee, WI", "Milwaukie, OR"]
        assert suggestions[0].type == "areas"
        assert suggestions[0].subtitle == "United States"

    def test_sends_the_key_in_a_header_and_searches_worldwide(self, tomtom: FakeTomTom) -> None:
        tomtom.client().suggest("milwau", limit=3)

        request = tomtom.requests[0]
        assert request.method == "POST"
        assert request.headers["TomTom-Api-Key"] == TEST_KEY
        assert request.headers["TomTom-Api-Version"] == "3"
        assert "key" not in request.url.params
        body = json.loads(request.content)
        assert body == {"query": "milwau", "maxResults": 3}

    def test_skips_results_without_a_details_reference(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("suggest", body={"results": [{"id": "x", "title": "No details"}]})

        assert tomtom.client().suggest("no") == []


class TestPlace:
    def test_returns_the_position_of_a_suggestion(self, tomtom: FakeTomTom) -> None:
        place = tomtom.client().place("areas", "FQ7v-lMA6etQH3Bm9hQ7uw")

        assert place.title == "Milwaukee, WI"
        assert place.position == LatLon(43.041072, -87.909421)
        assert tomtom.requests[0].url.path.endswith("/details/areas/FQ7v-lMA6etQH3Bm9hQ7uw")

    def test_unknown_places_raise_place_not_found(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("details", 404, load("details_not_found"))

        with pytest.raises(PlaceNotFoundError, match="No result found"):
            tomtom.client().place("areas", "unknown")

    @pytest.mark.parametrize(("place_type", "place_id"), [("areas", "../x"), ("Areas", "id")])
    def test_rejects_malformed_references_without_calling_tomtom(
        self, tomtom: FakeTomTom, place_type: str, place_id: str
    ) -> None:
        with pytest.raises(PlaceNotFoundError):
            tomtom.client().place(place_type, place_id)
        assert tomtom.requests == []

    def test_a_place_without_a_position_is_an_error(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("details", body={"title": "Somewhere"})

        with pytest.raises(TomTomError, match="without a position"):
            tomtom.client().place("areas", "id")


class TestGeocode:
    def test_returns_the_first_match(self, tomtom: FakeTomTom) -> None:
        place = tomtom.client().geocode("Milwaukee, WI")

        assert place.title == "Milwaukee, WI"
        assert place.position == LatLon(43.041072, -87.909421)
        request = tomtom.requests[0]
        assert request.url.raw_path.startswith(b"/search/2/geocode/Milwaukee%2C%20WI.json")
        assert "countrySet" not in request.url.params

    def test_no_match_raises_place_not_found(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", body={"results": []})

        with pytest.raises(PlaceNotFoundError):
            tomtom.client().geocode("Nowhere at all")

    def test_a_match_without_a_position_is_an_error(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", body={"results": [{"address": {}}]})

        with pytest.raises(TomTomError, match="without a position"):
            tomtom.client().geocode("Somewhere")


class TestTruckRoutes:
    def test_requests_a_truck_route_with_weight_and_progress(self, tomtom: FakeTomTom) -> None:
        tomtom.client().truck_routes(
            [CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=38_000, alternatives=2
        )

        params = tomtom.requests[0].url.params
        assert params["travelMode"] == "truck"
        assert params["vehicleWeight"] == "17237"  # 38,000 lb in kg
        assert params["vehicleCommercial"] == "true"
        assert params["departAt"] == "2026-10-21T18:00:00+00:00"
        assert params.get_list("extendedRouteRepresentation") == ["distance", "travelTime"]
        assert params["maxAlternatives"] == "2"
        assert params["alternativeType"] == "anyRoute"

    def test_omits_alternatives_for_single_routes(self, tomtom: FakeTomTom) -> None:
        tomtom.client().truck_routes([CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=20_000)

        assert "maxAlternatives" not in tomtom.requests[0].url.params

    def test_parses_routes(self, tomtom: FakeTomTom) -> None:
        routes = tomtom.client().truck_routes(
            [CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=38_000, alternatives=2
        )

        assert len(routes) == 3
        first = routes[0]
        assert first.length_m == 145_362
        assert first.travel_time_s == 6_187
        assert len(first.points) == 2_040
        assert first.progress[0].point_index == 0
        assert first.progress[-1].point_index == len(first.points) - 1
        assert first.departure.utcoffset() == timedelta(hours=-5)

    def test_joins_the_legs_of_a_route_through_a_via_point(self, tomtom: FakeTomTom) -> None:
        via = LatLon(42.30, -88.40)

        (route,) = tomtom.client().truck_routes(
            [CHICAGO, via, MILWAUKEE], depart_at=DEPART, load_lb=38_000
        )

        assert len(route.points) == 1_824 + 2_164
        assert route.progress[-1].point_index == len(route.points) - 1
        assert tomtom.requests[0].url.path.count(":") == 2

    def test_no_route_found(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("route", 400, load("route_no_route"))

        with pytest.raises(NoRouteFoundError, match="NO_ROUTE_FOUND"):
            tomtom.client().truck_routes([CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=1)

    def test_a_malformed_route_is_an_error(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("route", body={"routes": [{"summary": {}}]})

        with pytest.raises(TomTomError, match="could not read"):
            tomtom.client().truck_routes([CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=1)


class TestFailures:
    def test_retries_once_after_a_server_error(self, tomtom: FakeTomTom) -> None:
        responses = iter([httpx.Response(503), httpx.Response(200, json=load("geocode_milwaukee"))])
        tomtom.overrides["geocode"] = lambda request: next(responses)

        assert tomtom.client().geocode("Milwaukee").title == "Milwaukee, WI"
        assert len(tomtom.requests) == 2

    def test_gives_up_after_the_retry(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", 500)

        with pytest.raises(TomTomUnavailableError):
            tomtom.client().geocode("Milwaukee")
        assert len(tomtom.requests) == 2

    def test_timeouts_count_as_unavailable(self, tomtom: FakeTomTom) -> None:
        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("timed out", request=request)

        tomtom.overrides["geocode"] = timeout

        with pytest.raises(TomTomUnavailableError):
            tomtom.client().geocode("Milwaukee")

    def test_a_body_that_cannot_be_decoded_counts_as_unavailable(self, tomtom: FakeTomTom) -> None:
        def undecodable(request: httpx.Request) -> httpx.Response:
            raise httpx.DecodingError("bad gzip", request=request)

        tomtom.overrides["geocode"] = undecodable

        with pytest.raises(TomTomUnavailableError):
            tomtom.client().geocode("Milwaukee")

    def test_rate_limiting_is_not_retried(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", 429)

        with pytest.raises(TomTomUnavailableError, match="rate limiting"):
            tomtom.client().geocode("Milwaukee")
        assert len(tomtom.requests) == 1

    def test_a_rejected_key_is_reported(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", 403, {"detailedError": {"code": "FORBIDDEN"}})

        with pytest.raises(TomTomError, match="rejected the API key"):
            tomtom.client().geocode("Milwaukee")

    def test_other_client_errors_are_reported_with_their_code(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", 400, {"detailedError": {"code": "BAD_INPUT"}})

        with pytest.raises(TomTomError, match="HTTP 400 \\(BAD_INPUT\\)"):
            tomtom.client().geocode("Milwaukee")

    def test_an_error_without_a_json_body_is_still_reported(self, tomtom: FakeTomTom) -> None:
        tomtom.overrides["geocode"] = lambda request: httpx.Response(400, text="Bad Request")

        with pytest.raises(TomTomError, match="HTTP 400 \\(no error code\\)"):
            tomtom.client().geocode("Milwaukee")

    def test_a_response_that_is_not_json_is_an_error(self, tomtom: FakeTomTom) -> None:
        tomtom.overrides["geocode"] = lambda request: httpx.Response(200, text="<html>")

        with pytest.raises(TomTomError, match="not JSON"):
            tomtom.client().geocode("Milwaukee")

    def test_a_json_response_that_is_not_an_object_is_an_error(self, tomtom: FakeTomTom) -> None:
        tomtom.respond("geocode", body=[1, 2])

        with pytest.raises(TomTomError, match="unexpected response"):
            tomtom.client().geocode("Milwaukee")

    def test_the_key_never_appears_in_errors_or_logs(
        self, tomtom: FakeTomTom, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)
        tomtom.respond("route", 500)
        client = tomtom.client()

        with pytest.raises(TomTomUnavailableError) as error:
            client.truck_routes([CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=1)
        client.close()

        assert TEST_KEY in str(tomtom.requests[0].url)  # the key was sent ...
        assert TEST_KEY not in str(error.value)  # ... but never reported
        assert TEST_KEY not in caplog.text
        assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
