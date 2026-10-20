from datetime import UTC, datetime

import pytest

from routing.clients.tomtom import NoRouteFoundError
from routing.geo import LatLon, haversine_m
from routing.services.checkpoints import RouteTrack
from routing.services.route_options import (
    MAX_DETOUR_M,
    MIN_DETOUR_M,
    _detour_points,
    find_route_options,
)
from tests.routing.conftest import FakeTomTom, load

CHICAGO = LatLon(41.8781, -87.6298)
MILWAUKEE = LatLon(43.0389, -87.9065)
DEPART = datetime(2026, 10, 21, 18, tzinfo=UTC)


def find(tomtom: FakeTomTom) -> list[tuple[float, bool]]:
    options = find_route_options(
        tomtom.client(), CHICAGO, MILWAUKEE, depart_at=DEPART, load_lb=38_000
    )
    return [(option.route.length_m, option.detour) for option in options]


def only_the_main_route() -> dict[str, object]:
    recorded = load("route_chicago_milwaukee")
    return {**recorded, "routes": recorded["routes"][:1]}


def test_uses_tomtom_alternatives_when_there_are_enough(tomtom: FakeTomTom) -> None:
    assert find(tomtom) == [(145_362, False), (151_799, False), (312_609, False)]
    assert tomtom.count("via_route") == 0


def test_adds_detours_when_tomtom_returns_too_few_routes(tomtom: FakeTomTom) -> None:
    tomtom.respond("route", body=only_the_main_route())

    options = find(tomtom)

    assert options == [(145_362, False), (234_331, True)]
    # The same detour comes back for every via point, so it is only accepted once.
    assert tomtom.count("via_route") == 4


def test_rejects_detours_that_follow_the_same_roads(tomtom: FakeTomTom) -> None:
    tomtom.respond("route", body=only_the_main_route())
    tomtom.respond("via_route", body=only_the_main_route())

    assert find(tomtom) == [(145_362, False)]


def test_skips_detours_that_fail(tomtom: FakeTomTom) -> None:
    tomtom.respond("route", body=only_the_main_route())
    tomtom.respond("via_route", 400, load("route_no_route"))

    assert find(tomtom) == [(145_362, False)]


def test_no_route_at_all_is_an_error(tomtom: FakeTomTom) -> None:
    tomtom.respond("route", body={"routes": []})

    with pytest.raises(NoRouteFoundError):
        find(tomtom)


def test_detour_points_sit_on_both_sides_of_the_route_middle(tomtom: FakeTomTom) -> None:
    (main,) = tomtom.client().truck_routes([CHICAGO, MILWAUKEE], depart_at=DEPART, load_lb=1)[:1]
    track = RouteTrack(main)
    middle, _ = track.locate(track.length_m / 2)

    points = list(_detour_points(main, CHICAGO, MILWAUKEE))

    assert len(points) == 4
    near, far = MIN_DETOUR_M, 2 * MIN_DETOUR_M  # short trips use the minimum offset
    assert [round(haversine_m(middle, p) / 1000) for p in points] == [
        round(near / 1000),
        round(near / 1000),
        round(far / 1000),
        round(far / 1000),
    ]
    assert points[0].lon > middle.lon > points[1].lon  # east, then west of a northbound trip
    assert MIN_DETOUR_M < MAX_DETOUR_M
