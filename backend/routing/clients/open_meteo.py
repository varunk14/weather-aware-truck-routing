"""Client for the Open-Meteo forecast API: hourly wind, rain and snow for many points at once.

Open-Meteo needs no key. Several locations go into one GET request as comma-separated lists.
The URL length caps a request at a few hundred locations, so callers send at most
``MAX_POINTS_PER_REQUEST`` per call. Times are requested and returned in UTC.
"""

import logging
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from routing.geo import LatLon

logger = logging.getLogger(__name__)

BASE_URL = "https://api.open-meteo.com"
FORECAST_PATH = "/v1/forecast"
MAX_POINTS_PER_REQUEST = 200

# Variable name -> the unit Open-Meteo reports for it with the units requested below.
HOURLY_UNITS = {
    "wind_speed_10m": "mp/h",
    "wind_gusts_10m": "mp/h",
    "rain": "inch",
    "showers": "inch",
    "snowfall": "inch",
}
_HOUR_FORMAT = "%Y-%m-%dT%H:%M"

Value = float | None


class WeatherError(Exception):
    """Open-Meteo returned an error or a response Clearway cannot use."""


class WeatherUnavailableError(WeatherError):
    """Open-Meteo timed out, failed, or is rate limiting requests."""


@dataclass(frozen=True, slots=True)
class HourlyForecast:
    """Hourly forecast for one point. ``times`` are whole UTC hours; a value may be missing.

    Wind speed is the value at that hour. Gusts are the maximum, and rain, showers and
    snowfall the total, over the hour that ends at that time.
    """

    times: tuple[datetime, ...]
    wind_mph: tuple[Value, ...]
    gust_mph: tuple[Value, ...]
    rain_in: tuple[Value, ...]
    showers_in: tuple[Value, ...]
    snow_in: tuple[Value, ...]


class OpenMeteoClient:
    def __init__(
        self,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout_s: float = 10.0,
        retries: int = 1,
    ) -> None:
        self._retries = retries
        self._http = httpx.Client(
            base_url=BASE_URL,
            transport=transport,
            timeout=httpx.Timeout(timeout_s, connect=5.0),
            headers={"Accept": "application/json"},
        )

    def hourly(
        self, points: Sequence[LatLon], start: datetime, end: datetime
    ) -> list[HourlyForecast]:
        """Forecasts for ``points``, in the same order, for every hour from ``start`` to ``end``.

        ``start`` and ``end`` are included and must be timezone-aware whole hours.
        """
        if not points:
            return []
        if len(points) > MAX_POINTS_PER_REQUEST:
            raise ValueError(f"At most {MAX_POINTS_PER_REQUEST} points per request.")
        params = {
            "latitude": ",".join(f"{p.lat:.4f}" for p in points),
            "longitude": ",".join(f"{p.lon:.4f}" for p in points),
            "hourly": ",".join(HOURLY_UNITS),
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "GMT",
            "start_hour": _format_hour(start),
            "end_hour": _format_hour(end),
        }
        body = self._request(params)
        items = [body] if isinstance(body, dict) else body
        if not isinstance(items, list) or len(items) != len(points):
            raise WeatherError("Open-Meteo returned a different number of forecasts than asked.")
        try:
            return [_parse_forecast(item) for item in items]
        except (KeyError, TypeError, ValueError, OverflowError) as error:
            raise WeatherError("Open-Meteo returned a forecast Clearway could not read.") from error

    def close(self) -> None:
        self._http.close()

    def _request(self, params: dict[str, str]) -> Any:
        response = self._send(params)
        if not response.is_success:
            raise WeatherError(
                f"Open-Meteo returned HTTP {response.status_code}: {_reason(response)}"
            )
        try:
            return response.json()
        except ValueError as error:
            raise WeatherError("Open-Meteo returned a response that is not JSON.") from error

    def _send(self, params: dict[str, str]) -> httpx.Response:
        for _ in range(self._retries + 1):
            try:
                response = self._http.get(FORECAST_PATH, params=params)
            except httpx.RequestError as error:
                logger.warning("Open-Meteo request failed: %s", type(error).__name__)
            else:
                if response.status_code == 429:
                    raise WeatherUnavailableError("Open-Meteo is rate limiting requests.")
                if response.status_code < 500:
                    return response
                logger.warning("Open-Meteo returned %s", response.status_code)
        raise WeatherUnavailableError("Open-Meteo did not respond. Try again in a moment.")


def _format_hour(moment: datetime) -> str:
    if moment.tzinfo is None:
        raise ValueError("Forecast times must be timezone-aware.")
    utc = moment.astimezone(UTC)
    if (utc.minute, utc.second, utc.microsecond) != (0, 0, 0):
        raise ValueError(f"Forecast times must be whole hours, got {moment.isoformat()}")
    return utc.strftime(_HOUR_FORMAT)


def _reason(response: httpx.Response) -> str:
    try:
        return str(response.json()["reason"])
    except (ValueError, KeyError, TypeError):
        return "no reason given"


def _parse_forecast(item: dict[str, Any]) -> HourlyForecast:
    units = item["hourly_units"]
    for name, unit in HOURLY_UNITS.items():
        if units[name] != unit:
            raise ValueError(f"Unexpected unit for {name}: {units[name]!r}")
    hourly = item["hourly"]
    times = tuple(
        datetime.strptime(time, _HOUR_FORMAT).replace(tzinfo=UTC) for time in hourly["time"]
    )
    wind, gusts, rain, showers, snow = (_values(hourly[name], len(times)) for name in HOURLY_UNITS)
    return HourlyForecast(times, wind, gusts, rain, showers, snow)


def _values(raw: list[Any], length: int) -> tuple[Value, ...]:
    if len(raw) != length:
        raise ValueError("Every hourly series must have one value per hour.")
    if any(isinstance(value, bool) for value in raw):
        raise ValueError("Forecast values must be numbers.")
    values = tuple(None if value is None else float(value) for value in raw)
    if any(value is not None and (not math.isfinite(value) or value < 0) for value in values):
        raise ValueError("Forecast values must be finite and zero or more.")
    return values
