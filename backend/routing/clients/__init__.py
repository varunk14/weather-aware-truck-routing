"""Clients for third-party APIs."""

from functools import cache

from django.conf import settings

from routing.clients.tomtom import TomTomClient


@cache
def tomtom_client() -> TomTomClient:
    """The shared TomTom client, created on first use so a missing key only affects routing."""
    return TomTomClient(settings.TOMTOM_API_KEY)
