"""Resolving the trip's origin and destination to coordinates."""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass

from django.core.cache import cache

from routing.clients.tomtom import (
    Place,
    TomTomClient,
    TomTomError,
    TomTomNotConfiguredError,
)
from routing.geo import LatLon

PLACE_CACHE_S = 24 * 60 * 60


@dataclass(frozen=True, slots=True)
class PlaceRef:
    """A place picked from the suggestions list."""

    type: str
    id: str


@dataclass(frozen=True, slots=True)
class Coordinates:
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class Address:
    """Free text typed without picking a suggestion."""

    text: str


Location = PlaceRef | Coordinates | Address


def resolve(client: TomTomClient, location: Location) -> Place:
    match location:
        case Coordinates(lat=lat, lon=lon):
            return Place(title=f"{lat:.4f}, {lon:.4f}", position=LatLon(lat, lon))
        case PlaceRef(type=place_type, id=place_id):
            return _cached(
                f"place:{place_type}:{place_id}", lambda: client.place(place_type, place_id)
            )
        case Address(text=text):
            digest = hashlib.sha256(text.casefold().encode()).hexdigest()
            return _cached(f"text:{digest}", lambda: _from_text(client, text))


def _from_text(client: TomTomClient, text: str) -> Place:
    """Typed text that was not picked from the list: the place the list would have offered first.

    TomTom's address lookup alone does not know places by name, so "California Academy of
    Sciences" would become a street of that name elsewhere. The suggestions do, and the address
    lookup remains for text they cannot place.
    """
    try:
        suggestions = client.suggest(text, limit=3)
        if suggestions:
            return client.place(suggestions[0].type, suggestions[0].id)
    except TomTomNotConfiguredError:
        raise
    except TomTomError:
        pass
    return client.geocode(text)


def _cached(key: str, load: Callable[[], Place]) -> Place:
    place: Place | None = cache.get(key)
    if place is None:
        place = load()
        cache.set(key, place, PLACE_CACHE_S)
    return place
