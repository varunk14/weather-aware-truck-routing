"""Turns TomTom and Open-Meteo failures into clear API responses instead of server errors."""

import logging
from typing import Any

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from routing.clients.open_meteo import WeatherError, WeatherLimitError, WeatherUnavailableError
from routing.clients.tomtom import (
    NoRouteFoundError,
    PlaceNotFoundError,
    TomTomError,
    TomTomNotConfiguredError,
    TomTomUnavailableError,
)
from routing.services.weather import IncompleteForecastError

logger = logging.getLogger(__name__)

# Checked in order; the generic error of each service comes after its specific ones.
_UPSTREAM_ERRORS: tuple[tuple[type[Exception], int, str], ...] = (
    (
        TomTomNotConfiguredError,
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "Routing is not configured on the server.",
    ),
    (
        TomTomUnavailableError,
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "The routing service is not responding. Try again in a moment.",
    ),
    (
        PlaceNotFoundError,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "One of the places could not be found. Pick a suggestion or check the spelling.",
    ),
    (
        NoRouteFoundError,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "No truck route connects these places.",
    ),
    (
        TomTomError,
        status.HTTP_502_BAD_GATEWAY,
        "The routing service returned an unexpected response.",
    ),
    (
        WeatherUnavailableError,
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "The weather service is not responding. Try again in a moment.",
    ),
    (
        IncompleteForecastError,
        status.HTTP_502_BAD_GATEWAY,
        "The weather forecast is incomplete for part of this trip. Try again later.",
    ),
    (
        WeatherError,
        status.HTTP_502_BAD_GATEWAY,
        "The weather service returned an unexpected response.",
    ),
)


# Open-Meteo's free plan allows 10,000 calls a day (each forecast location is one call).
WEATHER_DAILY_LIMIT = (
    "The free weather service has reached its daily limit. Plans work again after midnight UTC."
)
WEATHER_BUSY = "The weather service is busy. Try again in a minute."


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    if isinstance(exc, WeatherLimitError):
        logger.warning("%s: %s", type(exc).__name__, exc)
        detail = WEATHER_DAILY_LIMIT if exc.daily else WEATHER_BUSY
        return Response({"detail": detail}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    for error_type, status_code, detail in _UPSTREAM_ERRORS:
        if isinstance(exc, error_type):
            logger.warning("%s: %s", type(exc).__name__, exc)
            return Response({"detail": detail}, status=status_code)
    return drf_exception_handler(exc, context)
