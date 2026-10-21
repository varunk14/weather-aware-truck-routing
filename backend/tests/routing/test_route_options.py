import itertools
import time
from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import pytest

from routing.clients.tomtom import NoRouteFoundError, TomTomUnavailableError
from routing.geo import LatLon, haversine_m
from routing.services import route_options
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


def asks_for_alternatives(request: httpx.Request) -> bool:
    return "maxAlternatives" in request.url.params


def test_uses_tomtom_alternatives_when_they_arrive_in_time(tomtom: FakeTomTom) -> None:
    assert find(tomtom) == [(145_362, False), (151_799, False), (312_609, False)]
    # The fastest route and TomTom's alternatives are asked for together.
    asked = sorted(asks_for_alternatives(r) for r in tomtom.requests if tomtom.kind(r) == "route")
    assert asked == [False, True]


def two_distinct_detours() -> Callable[[httpx.Request], httpx.Response]:
    """Via requests alternately return the recorded via route and the long western route."""
    recorded = load("route_chicago_milwaukee")
    bodies = itertools.cycle(
        [load("route_via_point"), {**recorded, "routes": recorded["routes"][2:]}]
    )
    return lambda request: httpx.Response(200, json=next(bodies))


def slow_alternatives(delay_s: float) -> Callable[[httpx.Request], httpx.Response]:
    def respond(request: httpx.Request) -> httpx.Response:
        if asks_for_alternatives(request):
            time.sleep(delay_s)
            return httpx.Response(200, json=load("route_chicago_milwaukee"))
        return httpx.Response(200, json=only_the_main_route())

    return respond


def test_uses_detours_when_tomtom_alternatives_are_slow(
    tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(route_options, "ALTERNATIVES_WAIT_S", 0.05)
    tomtom.overrides["route"] = slow_alternatives(0.5)
    tomtom.overrides["via_route"] = two_distinct_detours()

    started = time.monotonic()
    options = find(tomtom)

    assert options == [(145_362, False), (234_331, True), (312_609, True)]
    assert time.monotonic() - started < 0.5  # did not wait for TomTom's alternatives


def test_still_takes_tomtom_alternatives_when_detours_cannot_make_three(
    tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The recorded via route is the only distinct detour, so detours alone cannot make a set.
    monkeypatch.setattr(route_options, "ALTERNATIVES_WAIT_S", 0.05)
    tomtom.overrides["route"] = slow_alternatives(0.3)

    assert find(tomtom) == [(145_362, False), (151_799, False), (312_609, False)]


def test_gives_up_waiting_and_plans_with_the_routes_it_has(
    tomtom: FakeTomTom, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(route_options, "ALTERNATIVES_WAIT_S", 0.05)
    monkeypatch.setattr(route_options, "MAX_WAIT_S", 0.3)
    tomtom.overrides["route"] = slow_alternatives(2.0)

    started = time.monotonic()
    options = find(tomtom)

    assert options == [(145_362, False), (234_331, True)]
    assert time.monotonic() - started < 1.0


def test_uses_detours_when_tomtom_alternatives_fail(tomtom: FakeTomTom) -> None:
    # On very long trips TomTom answers the alternatives request with a server error.
    tomtom.overrides["route"] = lambda request: (
        httpx.Response(500)
        if asks_for_alternatives(request)
        else httpx.Response(200, json=only_the_main_route())
    )

    assert find(tomtom) == [(145_362, False), (234_331, True)]


def test_uses_tomtom_alternatives_when_the_fastest_route_request_fails(
    tomtom: FakeTomTom,
) -> None:
    tomtom.overrides["route"] = lambda request: (
        httpx.Response(200, json=load("route_chicago_milwaukee"))
        if asks_for_alternatives(request)
        else httpx.Response(503)
    )

    assert find(tomtom) == [(145_362, False), (151_799, False), (312_609, False)]


def test_reports_the_failure_when_every_route_request_fails(tomtom: FakeTomTom) -> None:
    tomtom.respond("route", 503)

    with pytest.raises(TomTomUnavailableError):
        find(tomtom)


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

    waves = list(_detour_points(main, CHICAGO, MILWAUKEE))
    points = [point for wave in waves for point in wave]

    assert [len(wave) for wave in waves] == [2, 2]  # near points first, then farther ones
    near, far = MIN_DETOUR_M, 2 * MIN_DETOUR_M  # short trips use the minimum offset
    assert [round(haversine_m(middle, p) / 1000) for p in points] == [
        round(near / 1000),
        round(near / 1000),
        round(far / 1000),
        round(far / 1000),
    ]
    assert points[0].lon > middle.lon > points[1].lon  # east, then west of a northbound trip
    assert MIN_DETOUR_M < MAX_DETOUR_M
