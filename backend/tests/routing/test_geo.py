import math
from itertools import pairwise

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from routing.geo import (
    LatLon,
    bearing_deg,
    cumulative_m,
    densify,
    destination,
    fraction_near,
    haversine_m,
    interpolate,
    sample_along,
    simplify,
)

CHICAGO = LatLon(41.8781, -87.6298)
MILWAUKEE = LatLon(43.0389, -87.9065)


def test_haversine_matches_the_known_distance_between_two_cities() -> None:
    assert haversine_m(CHICAGO, MILWAUKEE) == pytest.approx(130_500, rel=0.01)
    assert haversine_m(CHICAGO, CHICAGO) == 0


def test_cumulative_distance_starts_at_zero_and_adds_up() -> None:
    distances = cumulative_m([CHICAGO, MILWAUKEE, CHICAGO])

    assert distances[0] == 0
    assert distances[2] == pytest.approx(2 * haversine_m(CHICAGO, MILWAUKEE))


def test_interpolate_returns_the_point_between() -> None:
    assert interpolate(LatLon(0, 0), LatLon(10, 20), 0.25) == LatLon(2.5, 5)


def test_destination_and_bearing_agree() -> None:
    east = destination(CHICAGO, 90, 100_000)

    assert haversine_m(CHICAGO, east) == pytest.approx(100_000, abs=1)
    assert bearing_deg(CHICAGO, east) == pytest.approx(90, abs=0.5)
    assert bearing_deg(CHICAGO, MILWAUKEE) == pytest.approx(350, abs=2)


def test_densify_limits_the_gap_between_points() -> None:
    a, b = LatLon(40, -100), destination(LatLon(40, -100), 0, 10_000)

    dense = densify([a, b], 1_000)

    assert len(dense) == 11
    assert dense[0] == a
    assert dense[-1] == pytest.approx(b)
    assert max(haversine_m(p, q) for p, q in pairwise(dense)) <= 1_000.1


class TestSimplify:
    def test_a_straight_line_keeps_only_its_ends(self) -> None:
        line = [LatLon(40, -100 + i * 0.01) for i in range(100)]

        assert simplify(line, 10) == [line[0], line[-1]]

    def test_bends_larger_than_the_tolerance_are_kept(self) -> None:
        bend = destination(LatLon(40, -99.5), 0, 500)
        line = [LatLon(40, -100), bend, LatLon(40, -99)]

        assert simplify(line, 100) == line
        assert simplify(line, 1_000) == [line[0], line[-1]]

    def test_every_removed_point_stays_within_the_tolerance(self) -> None:
        wiggly = [destination(LatLon(40, -100 + i * 0.01), 0, (i % 7) * 40) for i in range(300)]

        simplified = simplify(wiggly, 100)

        assert len(simplified) < len(wiggly)
        assert fraction_near(wiggly, simplified, 101) == 1

    def test_short_lines_are_returned_unchanged(self) -> None:
        assert simplify([CHICAGO, MILWAUKEE], 10) == [CHICAGO, MILWAUKEE]


def plain_douglas_peucker(points: list[LatLon], tolerance_m: float) -> list[LatLon]:
    """The textbook algorithm, on the same flat projection, to check the fast one against."""
    ky = math.radians(1) * 6_371_008.8
    kx = ky * math.cos(math.radians(sum(p.lat for p in points) / len(points)))
    xy = [(p.lon * kx, p.lat * ky) for p in points]

    def distance(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == dy == 0:
            return math.hypot(p[0] - a[0], p[1] - a[1])
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)

    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        far = max(
            range(start + 1, end), key=lambda i: distance(xy[i], xy[start], xy[end]), default=None
        )
        if far is not None and distance(xy[far], xy[start], xy[end]) > tolerance_m:
            keep.add(far)
            stack.extend(((start, far), (far, end)))
    return [point for i, point in enumerate(points) if i in keep]


@settings(max_examples=200, deadline=None)
@given(
    st.lists(
        st.tuples(st.floats(40.0, 41.0), st.floats(-88.0, -87.0)),
        min_size=3,
        max_size=60,
    ),
    st.sampled_from([5.0, 30.0, 500.0, 5_000.0]),
)
def test_simplify_matches_the_textbook_algorithm(
    coordinates: list[tuple[float, float]], tolerance_m: float
) -> None:
    line = [LatLon(lat, lon) for lat, lon in coordinates]

    assert simplify(line, tolerance_m) == plain_douglas_peucker(line, tolerance_m)


class TestFractionNear:
    def test_a_line_is_entirely_near_itself(self) -> None:
        line = densify([CHICAGO, MILWAUKEE], 5_000)

        assert fraction_near(line, [CHICAGO, MILWAUKEE], 500) == 1

    def test_a_parallel_road_far_away_is_not_near(self) -> None:
        shifted = [destination(p, 90, 5_000) for p in (CHICAGO, MILWAUKEE)]
        samples = densify(shifted, 5_000)

        assert fraction_near(samples, [CHICAGO, MILWAUKEE], 2_000) == 0

    def test_empty_input_counts_as_not_near(self) -> None:
        assert fraction_near([], [CHICAGO], 100) == 0
        assert fraction_near([CHICAGO], [], 100) == 0


def test_sample_along_spaces_points_evenly_from_the_start() -> None:
    end = destination(LatLon(40, -100), 90, 10_000)

    samples = list(sample_along([LatLon(40, -100), end], 2_000))

    assert len(samples) == 6
    assert samples[0] == LatLon(40, -100)
    assert haversine_m(samples[0], samples[1]) == pytest.approx(2_000, rel=0.01)
