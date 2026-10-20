"""Turns third-party failures into clear API responses instead of server errors."""

import logging
from typing import Any

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from routing.clients.tomtom import (
    NoRouteFoundError,
    PlaceNotFoundError,
    TomTomError,
    TomTomNotConfiguredError,
    TomTomUnavailableError,
)

logger = logging.getLogger(__name__)

# Checked in order; the generic TomTomError comes last.
_TOMTOM_ERRORS: tuple[tuple[type[TomTomError], int, str], ...] = (
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
)


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    for error_type, status_code, detail in _TOMTOM_ERRORS:
        if isinstance(exc, error_type):
            logger.warning("%s: %s", type(exc).__name__, exc)
            return Response({"detail": detail}, status=status_code)
    return drf_exception_handler(exc, context)
