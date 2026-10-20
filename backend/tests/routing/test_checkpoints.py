from dataclasses import replace
from datetime import UTC, datetime

import pytest

from routing.clients.tomtom import ProgressPoint, TruckRoute
from routing.geo import METERS_PER_MILE, LatLon, fraction_near
from routing.services.checkpoints import RouteTrack, checkpoint_distances_m, place_checkpoints
from tests.routing.conftest import FakeTomTom

CHICAGO = LatLon(41.8781, -87.6298)
MILWAUKEE = LatLon(43.0389, -87.9065)


@pytest.fixture
def route(tomtom: FakeTomTom) -> TruckRoute:
    return tomtom.client().truck_routes(
        [CHICAGO, MILWAUKEE], depart_at=datetime(2026, 10, 21, 18, tzinfo=UTC), load_lb=38_000
    )[0]


class TestRouteTrack:
    def test_matches_tomtom_at_both_ends(self, route: TruckRoute) -> None:
        track = RouteTrack(route)

        assert track.length_m == route.length_m
        assert track.locate(0) == (route.points[0], 0)
        position, elapsed = track.locate(route.length_m)
        assert position == route.points[-1]
        assert elapsed == route.travel_time_s

    def test_travel_time_never_decreases_along_the_route(self, route: TruckRoute) -> None:
        track = RouteTrack(route)

        times = [track.locate(d)[1] for d in range(0, int(route.length_m), 500)]

        assert times == sorted(times)

    def test_rejects_progress_that_does_not_cover_the_route(self, route: TruckRoute) -> None:
        broken = replace(route, progress=(ProgressPoint(1, 0, 0), *route.progress[1:]))

        with pytest.raises(ValueError, match="cover the whole polyline"):
            RouteTrack(broken)


@pytest.mark.parametrize(
    ("length_mi", "interval_mi", "expected_mi"),
    [
        (100, 25, [0, 25, 50, 75, 100]),
        (100.5, 25, [0, 25, 50, 75, 100.5]),
        (102, 25, [0, 25, 50, 75, 100, 102]),
        (12, 10, [0, 10, 12]),
        (0.5, 10, [0, 0.5]),
    ],
)
def test_checkpoint_distances(
    length_mi: float, interval_mi: float, expected_mi: list[float]
) -> None:
    distances = checkpoint_distances_m(length_mi * METERS_PER_MILE, interval_mi)

    assert [round(d / METERS_PER_MILE, 3) for d in distances] == expected_mi


class TestPlaceCheckpoints:
    def test_places_checkpoints_every_interval_on_the_road(self, route: TruckRoute) -> None:
        checkpoints = place_checkpoints(route, 25)

        miles = [round(c.distance_m / METERS_PER_MILE, 1) for c in checkpoints]
        assert miles == [0, 25, 50, 75, 90.3]
        positions = [c.position for c in checkpoints]
        assert fraction_near(positions, route.points, 50) == 1

    def test_etas_run_from_departure_to_arrival(self, route: TruckRoute) -> None:
        checkpoints = place_checkpoints(route, 10)

        etas = [c.eta for c in checkpoints]
        assert etas[0] == route.departure
        assert abs((etas[-1] - route.arrival).total_seconds()) < 1
        assert etas == sorted(etas)

    def test_a_smaller_interval_gives_more_checkpoints(self, route: TruckRoute) -> None:
        assert len(place_checkpoints(route, 10)) > len(place_checkpoints(route, 50))
