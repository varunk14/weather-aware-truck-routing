"""The specification's ranking order, applied one criterion at a time."""

import pytest

from routing.risk import RouteOption, RouteRisk, rank_routes, recommend
from routing.risk.ranking import format_duration, format_miles


def option(
    route_id: str,
    minutes: float,
    *,
    low: float = 0,
    moderate: float = 0,
    high: float = 0,
    severe: float = 0,
    no_travel: float = 0,
) -> RouteOption:
    return RouteOption(
        route_id=route_id,
        duration_s=minutes * 60,
        risk=RouteRisk((low, moderate, high, severe, no_travel)),
    )


def ranked_ids(*options: RouteOption) -> list[str]:
    return [o.route_id for o in rank_routes(options)]


class TestRankRoutes:
    def test_any_no_travel_miles_rank_below_any_amount_of_severe_weather(self) -> None:
        a = option("A", 600, low=995, no_travel=5)
        b = option("B", 700, low=800, severe=200)

        assert ranked_ids(a, b) == ["B", "A"]

    def test_fewest_severe_miles_comes_first(self) -> None:
        a = option("A", 600, low=990, severe=10)
        b = option("B", 700, low=700, high=300)

        assert ranked_ids(a, b) == ["B", "A"]

    def test_then_fewest_high_miles(self) -> None:
        a = option("A", 600, low=950, high=50)
        b = option("B", 700, low=900, moderate=80, high=20)

        assert ranked_ids(a, b) == ["B", "A"]

    def test_then_lowest_average_risk(self) -> None:
        a = option("A", 600, low=500, moderate=500)
        b = option("B", 700, low=900, moderate=100)

        assert ranked_ids(a, b) == ["B", "A"]

    def test_then_shortest_travel_time(self) -> None:
        a = option("A", 700, low=1000)
        b = option("B", 600, low=1000)

        assert ranked_ids(a, b) == ["B", "A"]

    def test_full_ties_keep_the_input_order(self) -> None:
        a = option("A", 600, low=1000)
        b = option("B", 600, low=1000)

        assert ranked_ids(a, b) == ["A", "B"]
        assert ranked_ids(b, a) == ["B", "A"]

    def test_floating_point_noise_does_not_decide_the_ranking(self) -> None:
        a = option("A", 700, low=975, severe=25.000_000_1)
        b = option("B", 600, low=975, severe=25)

        assert ranked_ids(a, b) == ["B", "A"]

    def test_rejects_an_empty_list(self) -> None:
        with pytest.raises(ValueError, match="At least one route"):
            rank_routes([])

    def test_rejects_duplicate_ids(self) -> None:
        with pytest.raises(ValueError, match="unique"):
            rank_routes([option("A", 600, low=10), option("A", 700, low=10)])


class TestRecommend:
    def test_the_fastest_route_when_nothing_is_safer(self) -> None:
        recommendation = recommend([option("A", 600, low=1000), option("B", 650, low=1000)])

        assert recommendation.best.route_id == "A"
        assert recommendation.reason == "Fastest route, and no other route has less weather risk."
        assert recommendation.is_safe

    def test_explains_avoided_no_travel_conditions(self) -> None:
        recommendation = recommend(
            [option("A", 600, low=988, no_travel=12), option("B", 640, low=1000)]
        )

        assert recommendation.best.route_id == "B"
        assert recommendation.reason == (
            "Avoids 12 mi of No Travel conditions on the fastest route (Route A), "
            "for 40 min more driving."
        )

    def test_explains_avoided_severe_weather(self) -> None:
        recommendation = recommend(
            [option("A", 1020, low=925, severe=75), option("B", 1087, low=1100)]
        )

        assert recommendation.best.route_id == "B"
        assert recommendation.reason == (
            "Avoids 75 mi of Severe weather on the fastest route (Route A), "
            "for 1 h 07 min more driving."
        )

    def test_explains_less_severe_weather(self) -> None:
        recommendation = recommend(
            [option("A", 600, low=950, severe=50), option("B", 620, low=975, severe=25)]
        )

        assert recommendation.reason == (
            "Has 25 mi less Severe weather than the fastest route (Route A), "
            "for 20 min more driving."
        )

    def test_explains_avoided_high_risk_weather(self) -> None:
        recommendation = recommend([option("A", 600, low=960, high=40), option("B", 615, low=1000)])

        assert recommendation.reason == (
            "Avoids 40 mi of High-risk weather on the fastest route (Route A), "
            "for 15 min more driving."
        )

    def test_explains_lower_average_risk(self) -> None:
        recommendation = recommend(
            [option("A", 600, low=500, moderate=500), option("B", 605, low=900, moderate=100)]
        )

        assert recommendation.reason == (
            "Lower average weather risk than the fastest route (Route A): 0.10 vs 0.50, "
            "for 5 min more driving."
        )

    def test_shows_a_third_decimal_when_the_averages_look_the_same(self) -> None:
        # Average risk 0.090 against 0.094: both are 0.09 to two decimals.
        recommendation = recommend(
            [option("A", 600, low=906, moderate=94), option("B", 605, low=910, moderate=90)]
        )

        assert recommendation.reason == (
            "Lower average weather risk than the fastest route (Route A): 0.090 vs 0.094, "
            "for 5 min more driving."
        )

    def test_warns_when_every_route_crosses_no_travel_conditions(self) -> None:
        recommendation = recommend(
            [option("A", 600, low=970, no_travel=30), option("B", 700, low=988, no_travel=12)]
        )

        assert recommendation.best.route_id == "B"
        assert not recommendation.is_safe
        assert recommendation.reason == (
            "Every route crosses No Travel conditions. Route B has the fewest (12 mi); "
            "consider a later departure."
        )

    def test_returns_every_route_in_ranked_order(self) -> None:
        a = option("A", 600, low=950, severe=50)
        b = option("B", 650, low=1000)
        c = option("C", 640, low=980, high=20)

        recommendation = recommend([a, b, c])

        assert [o.route_id for o in recommendation.ranked] == ["B", "C", "A"]


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [(0, "0 min"), (89, "1 min"), (1200, "20 min"), (3600, "1 h 00 min"), (4020, "1 h 07 min")],
)
def test_format_duration(seconds: float, expected: str) -> None:
    assert format_duration(seconds) == expected


@pytest.mark.parametrize(
    ("miles", "expected"),
    [(0.04, "0 mi"), (2, "2 mi"), (2.5, "2.5 mi"), (75, "75 mi"), (1234.56, "1,235 mi")],
)
def test_format_miles(miles: float, expected: str) -> None:
    assert format_miles(miles) == expected
