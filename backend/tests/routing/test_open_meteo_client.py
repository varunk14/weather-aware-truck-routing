import copy
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import httpx
import pytest

from routing.clients import open_meteo_client
from routing.clients.open_meteo import (
    MAX_POINTS_PER_REQUEST,
    OpenMeteoClient,
    WeatherError,
    WeatherLimitError,
    WeatherUnavailableError,
)
from routing.geo import LatLon
from tests.routing.conftest import FakeOpenMeteo, load_open_meteo

# The recorded forecasts: Chicago, Waukegan and Milwaukee, 18:00 to 22:00 UTC.
CHICAGO = LatLon(41.88, -87.63)
WAUKEGAN = LatLon(42.46, -87.81)
MILWAUKEE = LatLon(43.04, -87.91)
START = datetime(2026, 10, 21, 18, tzinfo=UTC)
END = datetime(2026, 10, 21, 22, tzinfo=UTC)

Forecast = dict[str, Any]


def recorded(open_meteo: FakeOpenMeteo, name: str) -> None:
    open_meteo.respond(body=load_open_meteo(name))


def test_the_shared_client_is_created_once() -> None:
    open_meteo_client.cache_clear()
    try:
        assert isinstance(open_meteo_client(), OpenMeteoClient)
        assert open_meteo_client() is open_meteo_client()
    finally:
        open_meteo_client.cache_clear()


class TestRequest:
    def test_asks_for_hourly_wind_rain_and_snow_in_us_units(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.client().hourly([CHICAGO, MILWAUKEE], START, END)

        request = open_meteo.requests[0]
        params = request.url.params
        assert request.method == "GET"
        assert request.url.path == "/v1/forecast"
        assert params["latitude"] == "41.8800,43.0400"
        assert params["longitude"] == "-87.6300,-87.9100"
        assert params["hourly"] == "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
        assert params["wind_speed_unit"] == "mph"
        assert params["precipitation_unit"] == "inch"
        assert params["timezone"] == "GMT"
        assert params["start_hour"] == "2026-10-21T18:00"
        assert params["end_hour"] == "2026-10-21T22:00"

    def test_converts_the_window_to_utc(self, open_meteo: FakeOpenMeteo) -> None:
        chicago_time = timezone(timedelta(hours=-5))

        open_meteo.client().hourly(
            [CHICAGO], START.astimezone(chicago_time), END.astimezone(chicago_time)
        )

        assert open_meteo.requests[0].url.params["start_hour"] == "2026-10-21T18:00"

    def test_no_points_needs_no_request(self, open_meteo: FakeOpenMeteo) -> None:
        assert open_meteo.client().hourly([], START, END) == []
        assert open_meteo.requests == []

    def test_rejects_more_points_than_one_request_can_carry(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        with pytest.raises(ValueError, match="At most 200"):
            open_meteo.client().hourly([CHICAGO] * (MAX_POINTS_PER_REQUEST + 1), START, END)
        assert open_meteo.requests == []

    @pytest.mark.parametrize(
        ("start", "message"),
        [
            (datetime(2026, 10, 21, 18), "timezone-aware"),
            (START + timedelta(minutes=30), "whole hours"),
        ],
    )
    def test_rejects_times_that_are_not_whole_utc_hours(
        self, open_meteo: FakeOpenMeteo, start: datetime, message: str
    ) -> None:
        with pytest.raises(ValueError, match=message):
            open_meteo.client().hourly([CHICAGO], start, END)


class TestRecordedResponses:
    def test_parses_several_points_in_order(self, open_meteo: FakeOpenMeteo) -> None:
        recorded(open_meteo, "forecast_three_points")

        chicago, waukegan, milwaukee = open_meteo.client().hourly(
            [CHICAGO, WAUKEGAN, MILWAUKEE], START, END
        )

        assert chicago.times == tuple(START + timedelta(hours=h) for h in range(5))
        assert chicago.wind_mph == (2.4, 5.2, 6.0, 5.7, 5.4)
        assert chicago.gust_mph == (4.3, 5.1, 6.7, 6.3, 7.2)
        assert chicago.rain_in == chicago.showers_in == chicago.snow_in == (0.0,) * 5
        assert waukegan.wind_mph[0] == 4.6
        assert milwaukee.times[0].tzinfo is UTC

    def test_a_single_point_comes_back_as_an_object(self, open_meteo: FakeOpenMeteo) -> None:
        recorded(open_meteo, "forecast_one_point")

        (chicago,) = open_meteo.client().hourly([CHICAGO], START, END)

        assert chicago.wind_mph == (2.4, 5.2, 6.0, 5.7, 5.4)

    def test_missing_values_are_kept_as_none(self, open_meteo: FakeOpenMeteo) -> None:
        body = load_open_meteo("forecast_one_point")
        body["hourly"]["snowfall"][2] = None
        open_meteo.respond(body=body)

        (chicago,) = open_meteo.client().hourly([CHICAGO], START, END)

        assert chicago.snow_in == (0.0, 0.0, None, 0.0, 0.0)


class TestUnusableResponses:
    @pytest.fixture
    def forecast(self) -> Forecast:
        body: Forecast = copy.deepcopy(load_open_meteo("forecast_one_point"))
        return body

    def test_a_different_number_of_forecasts(self, open_meteo: FakeOpenMeteo) -> None:
        recorded(open_meteo, "forecast_one_point")

        with pytest.raises(WeatherError, match="different number"):
            open_meteo.client().hourly([CHICAGO, MILWAUKEE], START, END)

    def test_a_body_that_is_neither_an_object_nor_a_list(self, open_meteo: FakeOpenMeteo) -> None:
        open_meteo.respond(body="sunny")

        with pytest.raises(WeatherError, match="different number"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_unexpected_units(self, open_meteo: FakeOpenMeteo, forecast: Forecast) -> None:
        forecast["hourly_units"]["wind_speed_10m"] = "km/h"
        open_meteo.respond(body=forecast)

        with pytest.raises(WeatherError, match="could not read"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_series_of_different_lengths(
        self, open_meteo: FakeOpenMeteo, forecast: Forecast
    ) -> None:
        forecast["hourly"]["rain"].pop()
        open_meteo.respond(body=forecast)

        with pytest.raises(WeatherError, match="could not read"):
            open_meteo.client().hourly([CHICAGO], START, END)

    @pytest.mark.parametrize("value", [-0.1, "NaN"])
    def test_impossible_values(
        self, open_meteo: FakeOpenMeteo, forecast: Forecast, value: object
    ) -> None:
        forecast["hourly"]["wind_speed_10m"][0] = value
        open_meteo.respond(body=forecast)

        with pytest.raises(WeatherError, match="could not read"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_a_number_too_large_for_a_float(
        self, open_meteo: FakeOpenMeteo, forecast: Forecast
    ) -> None:
        forecast["hourly"]["rain"][0] = 10**400
        open_meteo.respond(body=forecast)

        with pytest.raises(WeatherError, match="could not read"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_a_value_that_is_not_a_number(
        self, open_meteo: FakeOpenMeteo, forecast: Forecast
    ) -> None:
        forecast["hourly"]["snowfall"][0] = True
        open_meteo.respond(body=forecast)

        with pytest.raises(WeatherError, match="could not read"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_a_missing_variable(self, open_meteo: FakeOpenMeteo, forecast: Forecast) -> None:
        del forecast["hourly"]["showers"]
        open_meteo.respond(body=forecast)

        with pytest.raises(WeatherError, match="could not read"):
            open_meteo.client().hourly([CHICAGO], START, END)


class TestFailures:
    def test_a_rejected_request_reports_open_meteos_reason(self, open_meteo: FakeOpenMeteo) -> None:
        open_meteo.respond(400, load_open_meteo("error_out_of_range"))

        with pytest.raises(WeatherError, match="HTTP 400: Parameter 'start_hour' is out of"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_an_error_without_a_reason(self, open_meteo: FakeOpenMeteo) -> None:
        open_meteo.override = lambda request: httpx.Response(404, text="Not Found")

        with pytest.raises(WeatherError, match="HTTP 404: no reason given"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_a_response_that_is_not_json(self, open_meteo: FakeOpenMeteo) -> None:
        open_meteo.override = lambda request: httpx.Response(200, text="<html>")

        with pytest.raises(WeatherError, match="not JSON"):
            open_meteo.client().hourly([CHICAGO], START, END)

    def test_retries_once_after_a_server_error(self, open_meteo: FakeOpenMeteo) -> None:
        responses = iter(
            [httpx.Response(502), httpx.Response(200, json=load_open_meteo("forecast_one_point"))]
        )
        open_meteo.override = lambda request: next(responses)

        (chicago,) = open_meteo.client().hourly([CHICAGO], START, END)

        assert chicago.wind_mph[0] == 2.4
        assert len(open_meteo.requests) == 2

    def test_gives_up_after_the_retry(self, open_meteo: FakeOpenMeteo) -> None:
        open_meteo.respond(500)

        with pytest.raises(WeatherUnavailableError, match="did not respond"):
            open_meteo.client().hourly([CHICAGO], START, END)
        assert len(open_meteo.requests) == 2

    def test_timeouts_count_as_unavailable(self, open_meteo: FakeOpenMeteo) -> None:
        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timed out", request=request)

        open_meteo.override = timeout
        client = open_meteo.client()

        with pytest.raises(WeatherUnavailableError):
            client.hourly([CHICAGO], START, END)
        client.close()

    def test_a_body_that_cannot_be_decoded_counts_as_unavailable(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        def undecodable(request: httpx.Request) -> httpx.Response:
            raise httpx.DecodingError("bad gzip", request=request)

        open_meteo.override = undecodable

        with pytest.raises(WeatherUnavailableError):
            open_meteo.client().hourly([CHICAGO], START, END)
        assert len(open_meteo.requests) == 2

    def test_rate_limiting_is_not_retried(self, open_meteo: FakeOpenMeteo) -> None:
        open_meteo.respond(429, {"error": True, "reason": "Too many requests"})

        with pytest.raises(WeatherLimitError, match="rate limiting") as raised:
            open_meteo.client().hourly([CHICAGO], START, END)
        assert len(open_meteo.requests) == 1
        assert raised.value.daily is False

    def test_the_daily_limit_is_told_apart(self, open_meteo: FakeOpenMeteo) -> None:
        reason = "Daily API request limit exceeded. Please try again tomorrow."
        open_meteo.respond(429, {"error": True, "reason": reason})

        with pytest.raises(WeatherLimitError) as raised:
            open_meteo.client().hourly([CHICAGO], START, END)
        assert raised.value.daily is True
