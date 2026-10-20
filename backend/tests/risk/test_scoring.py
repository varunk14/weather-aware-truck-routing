import math

import pytest

from routing.risk import RiskLevel, RiskSegment, RouteRisk, checkpoint_coverage


class TestCheckpointCoverage:
    def test_evenly_spaced_checkpoints_split_the_road_at_midpoints(self) -> None:
        assert checkpoint_coverage([0, 25, 50, 75, 100], total_mi=100) == [
            12.5,
            25,
            25,
            25,
            12.5,
        ]

    def test_a_short_final_stretch_is_covered_by_the_last_checkpoints(self) -> None:
        assert checkpoint_coverage([0, 25, 50, 60], total_mi=60) == [12.5, 25, 17.5, 5]

    def test_a_single_checkpoint_covers_the_whole_route(self) -> None:
        assert checkpoint_coverage([0], total_mi=40) == [40]

    def test_coverage_adds_up_to_the_route_length(self) -> None:
        coverage = checkpoint_coverage([0, 10, 20, 30, 37.4], total_mi=37.4)

        assert math.isclose(sum(coverage), 37.4)

    @pytest.mark.parametrize(
        ("distances", "total", "message"),
        [
            ([], 10, "At least one checkpoint"),
            ([0, 20, 10], 30, "ascending"),
            ([-1, 10], 30, "between the origin and the destination"),
            ([0, 40], 30, "between the origin and the destination"),
            ([0], 0, "total_mi"),
            ([0], math.nan, "total_mi"),
        ],
    )
    def test_rejects_invalid_input(
        self, distances: list[float], total: float, message: str
    ) -> None:
        with pytest.raises(ValueError, match=message):
            checkpoint_coverage(distances, total_mi=total)


class TestRouteRisk:
    def test_adds_up_miles_per_level(self) -> None:
        risk = RouteRisk.from_segments(
            [
                RiskSegment(12.5, RiskLevel.LOW),
                RiskSegment(25, RiskLevel.SEVERE),
                RiskSegment(25, RiskLevel.HIGH),
                RiskSegment(25, RiskLevel.SEVERE),
                RiskSegment(12.5, RiskLevel.LOW),
            ]
        )

        assert risk.miles_by_level == (25, 0, 25, 50, 0)
        assert risk.total_miles == 100
        assert (risk.no_travel_miles, risk.severe_miles, risk.high_miles) == (0, 50, 25)
        assert risk.worst_level == RiskLevel.SEVERE

    def test_average_risk_is_weighted_by_miles(self) -> None:
        risk = RouteRisk.from_segments(
            [RiskSegment(90, RiskLevel.LOW), RiskSegment(10, RiskLevel.NO_TRAVEL)]
        )

        # (90 * 0 + 10 * 4) / 100
        assert risk.average_risk == pytest.approx(0.4)

    def test_rejects_negative_or_non_finite_miles(self) -> None:
        with pytest.raises(ValueError, match="zero or more"):
            RouteRisk.from_segments([RiskSegment(-5, RiskLevel.LOW)])
        with pytest.raises(ValueError, match="zero or more"):
            RouteRisk.from_segments([RiskSegment(math.inf, RiskLevel.LOW)])

    def test_rejects_a_route_without_length(self) -> None:
        with pytest.raises(ValueError, match="positive length"):
            RouteRisk.from_segments([RiskSegment(0, RiskLevel.LOW)])
        with pytest.raises(ValueError, match="positive length"):
            RouteRisk.from_segments([])
