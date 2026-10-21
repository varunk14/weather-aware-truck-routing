"""Weather at each checkpoint for the hour the truck is expected to reach it.

Open-Meteo reports rain, showers, snowfall and gusts over the hour ending at each time, so they
come from the hour that contains the arrival: an arrival at 12:37 uses the 13:00 values (12:00
to 13:00). Wind speed is an instant value, so it comes from the nearest whole hour.

Checkpoints within the same small grid cell (the shared origin and destination of the routes,
for example) are merged into one location. Locations are fetched in batches ordered by arrival
time, so each request only asks for the hours its checkpoints need, and batches run in parallel.
"""

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import batched

from routing.clients.open_meteo import (
    MAX_POINTS_PER_REQUEST,
    HourlyForecast,
    OpenMeteoClient,
    Value,
    WeatherError,
)
from routing.geo import LatLon
from routing.risk import Conditions

# Locations rounded to 0.01 degrees (about 1 km) share a forecast.
LOCATION_DECIMALS = 2
# A missing value is replaced by the nearest value at most this many hours away.
FALLBACK_HOURS = 2
# Batches fetched at the same time; long trips at 10 mile spacing need up to about five.
MAX_PARALLEL_REQUESTS = 4
HOUR = timedelta(hours=1)


class IncompleteForecastError(WeatherError):
    """The forecast has no value near the hour a checkpoint needs."""


@dataclass(frozen=True, slots=True)
class Weather:
    wind_mph: float
    gust_mph: float
    rain_in_per_hr: float
    snow_in_per_hr: float

    @property
    def conditions(self) -> Conditions:
        return Conditions(
            wind_mph=self.wind_mph,
            rain_in_per_hr=self.rain_in_per_hr,
            snow_in_per_hr=self.snow_in_per_hr,
        )


@dataclass(frozen=True, slots=True)
class Stop:
    """A place and the time the truck is expected there."""

    position: LatLon
    eta: datetime


def weather_at_stops(client: OpenMeteoClient, stops: Sequence[Stop]) -> list[Weather]:
    """Weather for every stop, in order, fetched with as few requests as possible."""
    etas: dict[LatLon, list[datetime]] = {}
    keys = []
    for stop in stops:
        key = _location_key(stop.position)
        keys.append(key)
        etas.setdefault(key, []).append(stop.eta)

    def fetch(batch: tuple[LatLon, ...]) -> list[HourlyForecast]:
        times = [eta for key in batch for eta in etas[key]]
        start = floor_hour(min(times)) - FALLBACK_HOURS * HOUR
        end = ceil_hour(max(times)) + FALLBACK_HOURS * HOUR
        return client.hourly(batch, start, end)

    batches = list(batched(sorted(etas, key=lambda key: min(etas[key])), MAX_POINTS_PER_REQUEST))
    if len(batches) > 1:
        with ThreadPoolExecutor(max_workers=min(len(batches), MAX_PARALLEL_REQUESTS)) as pool:
            results = list(pool.map(fetch, batches))
    else:
        results = [fetch(batch) for batch in batches]

    forecasts: dict[LatLon, HourlyForecast] = {}
    for batch, result in zip(batches, results, strict=True):
        forecasts.update(zip(batch, result, strict=True))
    return [weather_at(forecasts[key], stop.eta) for key, stop in zip(keys, stops, strict=True)]


def weather_at(forecast: HourlyForecast, eta: datetime) -> Weather:
    hour_total = ceil_hour(eta)
    return Weather(
        wind_mph=_total(forecast, nearest_hour(eta), "wind speed", forecast.wind_mph),
        gust_mph=_total(forecast, hour_total, "wind gusts", forecast.gust_mph),
        # Rain and showers always come from the same hour, also after a fallback.
        rain_in_per_hr=_total(forecast, hour_total, "rain", forecast.rain_in, forecast.showers_in),
        snow_in_per_hr=_total(forecast, hour_total, "snowfall", forecast.snow_in),
    )


def floor_hour(moment: datetime) -> datetime:
    """The whole UTC hour at or before ``moment`` (UTC, so half-hour time zones work too)."""
    return moment.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def ceil_hour(moment: datetime) -> datetime:
    floor = floor_hour(moment)
    return floor if floor == moment else floor + HOUR


def nearest_hour(moment: datetime) -> datetime:
    return floor_hour(moment + HOUR / 2)


def _location_key(position: LatLon) -> LatLon:
    return LatLon(round(position.lat, LOCATION_DECIMALS), round(position.lon, LOCATION_DECIMALS))


def _total(
    forecast: HourlyForecast, hour: datetime, name: str, *series: tuple[Value, ...]
) -> float:
    """The sum of ``series`` at ``hour``, or at the nearest hour within the fallback window
    (earlier first) where every one of them has a value."""
    if forecast.times:
        index = round((hour - forecast.times[0]) / HOUR)
        for offset in _OFFSETS:
            i = index + offset
            if 0 <= i < len(forecast.times) and forecast.times[i] == hour + offset * HOUR:
                values = [one[i] for one in series]
                if None not in values:
                    return sum(value for value in values if value is not None)
    raise IncompleteForecastError(
        f"The forecast has no {name} within {FALLBACK_HOURS} hours of {hour.isoformat()}."
    )


# 0, -1, +1, -2, +2: the requested hour first, then outwards, earlier before later.
_OFFSETS = (0, *(sign * d for d in range(1, FALLBACK_HOURS + 1) for sign in (-1, 1)))
