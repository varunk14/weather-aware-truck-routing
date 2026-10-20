"""Rules that must hold for every input, checked on generated values."""

import math

from hypothesis import given
from hypothesis import strategies as st

from routing.risk import (
    Conditions,
    RouteOption,
    RouteRisk,
    assess_checkpoint,
    checkpoint_coverage,
    recommend,
    wind_level_for_load,
)
from routing.risk.classification import RAIN_IN_PER_HR, SNOW_IN_PER_HR, WIND_MPH, Thresholds
from routing.risk.ranking import ranking_key

amounts = st.floats(min_value=0, max_value=200, allow_nan=False, allow_infinity=False)
loads = st.floats(min_value=1, max_value=80_000, allow_nan=False, allow_infinity=False)
thresholds = st.sampled_from([WIND_MPH, RAIN_IN_PER_HR, SNOW_IN_PER_HR])


@given(thresholds, amounts, amounts)
def test_more_wind_rain_or_snow_never_lowers_the_level(
    table: Thresholds, first: float, second: float
) -> None:
    lower, higher = sorted((first, second))

    assert table.classify(lower) <= table.classify(higher)


@given(amounts, loads, loads)
def test_a_heavier_load_never_lowers_the_level(wind: float, first: float, second: float) -> None:
    lighter, heavier = sorted((first, second))

    assert wind_level_for_load(wind, lighter) <= wind_level_for_load(wind, heavier)


@given(amounts, amounts, amounts, loads)
def test_a_checkpoint_is_at_least_as_risky_as_each_condition(
    wind: float, rain: float, snow: float, load: float
) -> None:
    risk = assess_checkpoint(Conditions(wind, rain, snow), load)

    assert risk.level >= max(risk.wind, risk.rain, risk.snow)
    assert risk.causes or risk.level == 0


@given(
    st.lists(st.floats(min_value=0, max_value=2_000, allow_nan=False), min_size=1, max_size=60),
    st.floats(min_value=0.1, max_value=100, allow_nan=False),
)
def test_coverage_is_never_negative_and_adds_up_to_the_route(
    distances: list[float], beyond_last: float
) -> None:
    ordered = sorted(distances)
    total = ordered[-1] + beyond_last

    coverage = checkpoint_coverage(ordered, total)

    assert all(miles >= 0 for miles in coverage)
    assert math.isclose(sum(coverage), total, rel_tol=1e-9)


miles = st.floats(min_value=0, max_value=500, allow_nan=False, allow_infinity=False)
route_risks = st.tuples(miles.map(lambda m: m + 1), miles, miles, miles, miles).map(RouteRisk)
durations = st.floats(min_value=60, max_value=200_000, allow_nan=False)
route_lists = st.lists(st.tuples(route_risks, durations), min_size=1, max_size=5).map(
    lambda items: [
        RouteOption(route_id=chr(ord("A") + i), duration_s=duration, risk=risk)
        for i, (risk, duration) in enumerate(items)
    ]
)


@given(route_lists)
def test_the_recommended_route_is_never_worse_than_another(options: list[RouteOption]) -> None:
    recommendation = recommend(options)

    assert all(ranking_key(recommendation.best) <= ranking_key(o) for o in options)
    assert sorted(o.route_id for o in recommendation.ranked) == [o.route_id for o in options]
    assert recommendation.reason
