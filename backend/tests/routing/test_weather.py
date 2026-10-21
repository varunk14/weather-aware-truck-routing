from datetime import UTC, datetime, timedelta, timezone

import pytest

from routing.clients.open_meteo import HourlyForecast, Value
from routing.geo import LatLon
from routing.risk import Conditions
from routing.services.weather import (
    IncompleteForecastError,
    Stop,
    Weather,
    ceil_hour,
    floor_hour,
    nearest_hour,
    weather_at,
    weather_at_stops,
)
from tests.routing.conftest import CALM, HOUR_FORMAT, FakeOpenMeteo, WeatherValues

NOON = datetime(2026, 10, 21, 12, tzinfo=UTC)
CHICAGO_TIME = timezone(timedelta(hours=-5))
ST_JOHNS_TIME = timezone(timedelta(hours=-2, minutes=-30))


def at(hours: float) -> datetime:
    return NOON + timedelta(hours=hours)


def forecast(
    *,
    wind: list[Value] | None = None,
    rain: list[Value] | None = None,
    showers: list[Value] | None = None,
    snow: list[Value] | None = None,
) -> HourlyForecast:
    """Five hours, 10:00 to 14:00 UTC. Each value defaults to the hour (10.0 ... 14.0)."""
    hours = tuple(NOON + timedelta(hours=h) for h in range(-2, 3))
    default: list[Value] = [float(h.hour) for h in hours]
    return HourlyForecast(
        times=hours,
        wind_mph=tuple(wind or default),
        gust_mph=tuple(wind or default),
        rain_in=tuple(rain or [0.0] * 5),
        showers_in=tuple(showers or [0.0] * 5),
        snow_in=tuple(snow or default),
    )


class TestHours:
    @pytest.mark.parametrize(
        ("moment", "floor", "ceil", "nearest"),
        [
            (at(0), at(0), at(0), at(0)),
            (at(37 / 60), at(0), at(1), at(1)),
            (at(29 / 60), at(0), at(1), at(0)),
            (at(30 / 60), at(0), at(1), at(1)),
            (at(1 / 3600), at(0), at(1), at(0)),
        ],
    )
    def test_whole_hours(
        self, moment: datetime, floor: datetime, ceil: datetime, nearest: datetime
    ) -> None:
        assert floor_hour(moment) == floor
        assert ceil_hour(moment) == ceil
        assert nearest_hour(moment) == nearest

    def test_results_are_utc_whatever_the_input_time_zone(self) -> None:
        assert floor_hour(at(0.6).astimezone(CHICAGO_TIME)) == at(0)
        assert floor_hour(at(0.6).astimezone(CHICAGO_TIME)).tzinfo is UTC

    def test_half_hour_time_zones_round_on_utc_hours(self) -> None:
        # 09:45 in Newfoundland is 12:15 UTC.
        moment = datetime(2026, 10, 21, 9, 45, tzinfo=ST_JOHNS_TIME)

        assert floor_hour(moment) == at(0)
        assert ceil_hour(moment) == at(1)
        assert nearest_hour(moment) == at(0)


class TestWeatherAt:
    def test_precipitation_comes_from_the_hour_containing_the_arrival(self) -> None:
        # Snow at 13:00 is the total from 12:00 to 13:00, so a 12:37 arrival uses it.
        weather = weather_at(forecast(), at(37 / 60))

        assert weather.snow_in_per_hr == 13.0

    def test_wind_comes_from_the_nearest_hour(self) -> None:
        assert weather_at(forecast(), at(29 / 60)).wind_mph == 12.0
        assert weather_at(forecast(), at(31 / 60)).wind_mph == 13.0

    def test_gusts_come_from_the_hour_containing_the_arrival(self) -> None:
        # Gusts at 13:00 are the strongest from 12:00 to 13:00, like the precipitation totals.
        assert weather_at(forecast(), at(20 / 60)).gust_mph == 13.0

    def test_an_arrival_on_the_hour_uses_that_hour(self) -> None:
        weather = weather_at(forecast(), at(0))

        assert (weather.wind_mph, weather.snow_in_per_hr) == (12.0, 12.0)

    def test_rain_includes_showers(self) -> None:
        weather = weather_at(
            forecast(rain=[0.0, 0.0, 0.2, 0.0, 0.0], showers=[0.0, 0.0, 0.15, 0.0, 0.0]), at(0)
        )

        assert weather.rain_in_per_hr == pytest.approx(0.35)

    def test_arrival_times_in_other_time_zones(self) -> None:
        weather = weather_at(forecast(), at(37 / 60).astimezone(CHICAGO_TIME))

        assert (weather.wind_mph, weather.snow_in_per_hr) == (13.0, 13.0)

    def test_a_missing_value_uses_the_hour_before_first(self) -> None:
        weather = weather_at(forecast(snow=[10.0, 11.0, None, 13.0, 14.0]), at(0))

        assert weather.snow_in_per_hr == 11.0

    def test_then_the_hour_after(self) -> None:
        weather = weather_at(forecast(snow=[10.0, None, None, 13.0, 14.0]), at(0))

        assert weather.snow_in_per_hr == 13.0

    def test_then_two_hours_away(self) -> None:
        weather = weather_at(forecast(snow=[10.0, None, None, None, 14.0]), at(0))

        assert weather.snow_in_per_hr == 10.0

    def test_rain_and_showers_always_come_from_the_same_hour(self) -> None:
        # Showers are missing at 12:00, so both come from 11:00 rather than mixing two hours.
        weather = weather_at(
            forecast(rain=[0.0, 0.1, 0.5, 0.0, 0.0], showers=[0.0, 0.2, None, 0.0, 0.0]), at(0)
        )

        assert weather.rain_in_per_hr == pytest.approx(0.3)

    def test_nothing_within_two_hours_is_an_error(self) -> None:
        with pytest.raises(IncompleteForecastError, match="no snowfall within 2 hours"):
            weather_at(forecast(snow=[None] * 5), at(0))

    def test_an_arrival_outside_the_forecast_is_an_error(self) -> None:
        with pytest.raises(IncompleteForecastError, match="wind speed"):
            weather_at(forecast(), at(6))

    def test_an_empty_forecast_is_an_error(self) -> None:
        empty = HourlyForecast((), (), (), (), (), ())

        with pytest.raises(IncompleteForecastError):
            weather_at(empty, at(0))

    def test_gaps_in_the_forecast_hours_are_never_mistaken_for_other_hours(self) -> None:
        # 12:00 is missing from the times, so position 2 holds 13:00 and must not be used.
        hours = (at(-2), at(-1), at(1), at(2))
        values: tuple[Value, ...] = (10.0, 11.0, 13.0, 14.0)
        gappy = HourlyForecast(hours, values, values, values, values, values)

        assert weather_at(gappy, at(0)).wind_mph == 11.0

    def test_conditions_for_the_risk_rules(self) -> None:
        weather = Weather(wind_mph=30, gust_mph=45, rain_in_per_hr=0.2, snow_in_per_hr=0.1)

        assert weather.conditions == Conditions(wind_mph=30, rain_in_per_hr=0.2, snow_in_per_hr=0.1)


class TestWeatherAtStops:
    def test_no_stops_need_no_request(self, open_meteo: FakeOpenMeteo) -> None:
        assert weather_at_stops(open_meteo.client(), []) == []
        assert open_meteo.requests == []

    def test_returns_weather_for_each_stop_in_order(self, open_meteo: FakeOpenMeteo) -> None:
        def by_place(point: LatLon, hour: datetime) -> WeatherValues:
            return {**CALM, "wind_speed_10m": 20.0 if point.lat > 42 else 5.0}

        open_meteo.weather = by_place
        stops = [Stop(LatLon(43.04, -87.91), at(1)), Stop(LatLon(41.88, -87.63), at(0))]

        weather = weather_at_stops(open_meteo.client(), stops)

        assert [w.wind_mph for w in weather] == [20.0, 5.0]

    def test_stops_within_the_same_kilometre_share_one_forecast(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        stops = [
            Stop(LatLon(41.8781, -87.6298), at(0)),
            Stop(LatLon(41.8790, -87.6310), at(0.2)),
            Stop(LatLon(42.5000, -87.8000), at(1)),
        ]

        weather_at_stops(open_meteo.client(), stops)

        assert open_meteo.points_requested() == 2
        assert open_meteo.requests[0].url.params["latitude"] == "41.8800,42.5000"

    def test_asks_only_for_the_hours_needed_plus_the_fallback_window(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        stops = [Stop(LatLon(41.88, -87.63), at(0.25)), Stop(LatLon(42.5, -87.8), at(3.5))]

        weather_at_stops(open_meteo.client(), stops)

        params = open_meteo.requests[0].url.params
        assert params["start_hour"] == at(-2).strftime(HOUR_FORMAT)
        assert params["end_hour"] == at(6).strftime(HOUR_FORMAT)

    def test_large_trips_are_split_into_batches_ordered_by_arrival(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        # 450 stops, 0.1 degrees apart, one every 10 minutes, given in reverse order.
        stops = [Stop(LatLon(30 + i / 10, -90), at(i / 6)) for i in reversed(range(450))]

        weather = weather_at_stops(open_meteo.client(), stops)

        assert len(weather) == 450
        # Batches run in parallel, so compare them in order of their first hour.
        batches = sorted(
            (r.url.params["start_hour"], r.url.params["end_hour"], r.url.params["latitude"])
            for r in open_meteo.requests
        )
        assert [len(latitudes.split(",")) for _, _, latitudes in batches] == [200, 200, 50]
        # Each batch asks only for its own stretch of the trip.
        assert batches[0][:2] == (at(-2).strftime(HOUR_FORMAT), at(36).strftime(HOUR_FORMAT))
        assert batches[1][0] == at(31).strftime(HOUR_FORMAT)
        assert batches[2][0] == at(64).strftime(HOUR_FORMAT)
        assert weather[0].wind_mph == CALM["wind_speed_10m"]

    def test_a_place_passed_twice_gets_one_window_covering_both_visits(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        def by_hour(point: LatLon, hour: datetime) -> WeatherValues:
            return {**CALM, "wind_speed_10m": float(hour.hour)}

        open_meteo.weather = by_hour
        chicago = LatLon(41.88, -87.63)

        weather = weather_at_stops(
            open_meteo.client(), [Stop(chicago, at(0)), Stop(chicago, at(9))]
        )

        assert open_meteo.points_requested() == 1
        params = open_meteo.requests[0].url.params
        assert (params["start_hour"], params["end_hour"]) == (
            at(-2).strftime(HOUR_FORMAT),
            at(11).strftime(HOUR_FORMAT),
        )
        assert [w.wind_mph for w in weather] == [12.0, 21.0]
