"""Every band edge of the specification's threshold table, and every load rule."""

import math

import pytest

from routing.risk import Conditions, RiskLevel, assess_checkpoint, wind_level_for_load
from routing.risk.classification import RAIN_IN_PER_HR, SNOW_IN_PER_HR, WIND_MPH

LOW = RiskLevel.LOW
MODERATE = RiskLevel.MODERATE
HIGH = RiskLevel.HIGH
SEVERE = RiskLevel.SEVERE
NO_TRAVEL = RiskLevel.NO_TRAVEL

# Wind: <25 Low, 25-34 Moderate, 35-44 High, 45-54 Severe, >=55 No Travel.
WIND_CASES = [
    (0, LOW),
    (24.9, LOW),
    (25, MODERATE),
    (34.9, MODERATE),
    (35, HIGH),
    (44.9, HIGH),
    (45, SEVERE),
    (54.9, SEVERE),
    (55, NO_TRAVEL),
    (90, NO_TRAVEL),
]

# Rain: <0.10 Low, 0.10-0.25 Moderate, 0.25-0.50 High, 0.50-1.00 Severe, >1.00 No Travel.
RAIN_CASES = [
    (0, LOW),
    (0.09, LOW),
    (0.10, MODERATE),
    (0.24, MODERATE),
    (0.25, HIGH),
    (0.49, HIGH),
    (0.50, SEVERE),
    (1.00, SEVERE),
    (1.01, NO_TRAVEL),
    (3.5, NO_TRAVEL),
]

# Snow: <0.5 Low, 0.5-1.0 Moderate, 1.0-2.0 High, 2.0-3.0 Severe, >3.0 No Travel.
SNOW_CASES = [
    (0, LOW),
    (0.49, LOW),
    (0.5, MODERATE),
    (0.99, MODERATE),
    (1.0, HIGH),
    (1.99, HIGH),
    (2.0, SEVERE),
    (3.0, SEVERE),
    (3.01, NO_TRAVEL),
    (6, NO_TRAVEL),
]


@pytest.mark.parametrize(("mph", "expected"), WIND_CASES)
def test_wind_bands(mph: float, expected: RiskLevel) -> None:
    assert WIND_MPH.classify(mph) == expected


@pytest.mark.parametrize(("in_per_hr", "expected"), RAIN_CASES)
def test_rain_bands(in_per_hr: float, expected: RiskLevel) -> None:
    assert RAIN_IN_PER_HR.classify(in_per_hr) == expected


@pytest.mark.parametrize(("in_per_hr", "expected"), SNOW_CASES)
def test_snow_bands(in_per_hr: float, expected: RiskLevel) -> None:
    assert SNOW_IN_PER_HR.classify(in_per_hr) == expected


@pytest.mark.parametrize(
    ("mph", "load_lb", "expected"),
    [
        # 55 mph or more is No Travel for any load.
        (55, 1, NO_TRAVEL),
        (70, 80_000, NO_TRAVEL),
        # 45 to 54 mph with more than 30,000 lb is No Travel.
        (45, 30_000, SEVERE),
        (45, 30_001, NO_TRAVEL),
        (54.9, 30_000, SEVERE),
        (54.9, 30_001, NO_TRAVEL),
        # 35 to 44 mph with more than 40,000 lb is Severe.
        (35, 40_000, HIGH),
        (35, 40_001, SEVERE),
        (44.9, 40_000, HIGH),
        (44.9, 80_000, SEVERE),
        # Below 35 mph the load makes no difference.
        (34.9, 80_000, MODERATE),
        (0, 80_000, LOW),
    ],
)
def test_load_rules(mph: float, load_lb: float, expected: RiskLevel) -> None:
    assert wind_level_for_load(mph, load_lb) == expected


class TestAssessCheckpoint:
    def test_calm_weather_is_low_with_no_causes(self) -> None:
        risk = assess_checkpoint(Conditions(10, 0, 0), load_lb=20_000)

        assert risk.level == LOW
        assert risk.causes == ()

    def test_the_worst_condition_sets_the_level(self) -> None:
        risk = assess_checkpoint(Conditions(10, 0.3, 0.6), load_lb=20_000)

        assert (risk.wind, risk.rain, risk.snow) == (LOW, HIGH, MODERATE)
        assert risk.level == HIGH
        assert risk.causes == ("rain",)

    def test_every_condition_at_the_worst_level_is_a_cause(self) -> None:
        risk = assess_checkpoint(Conditions(36, 0.3, 1.2), load_lb=20_000)

        assert risk.level == HIGH
        assert risk.causes == ("wind", "rain", "snow")

    def test_a_heavy_load_raises_high_wind_to_severe(self) -> None:
        risk = assess_checkpoint(Conditions(40, 0, 0), load_lb=42_000)

        assert risk.wind == HIGH
        assert risk.level == SEVERE
        assert risk.raised_by_load
        assert risk.causes == ("wind", "load")

    def test_a_heavy_load_makes_severe_wind_no_travel(self) -> None:
        risk = assess_checkpoint(Conditions(50, 0, 0), load_lb=35_000)

        assert risk.level == NO_TRAVEL
        assert risk.raised_by_load

    def test_the_load_rules_never_lower_a_level_set_by_rain_or_snow(self) -> None:
        risk = assess_checkpoint(Conditions(40, 1.5, 0), load_lb=42_000)

        assert risk.level == NO_TRAVEL
        assert not risk.raised_by_load
        assert risk.causes == ("rain",)

    def test_the_load_does_not_count_as_a_cause_when_weather_is_already_as_bad(self) -> None:
        risk = assess_checkpoint(Conditions(40, 0.6, 0), load_lb=42_000)

        assert risk.level == SEVERE
        assert not risk.raised_by_load
        assert risk.causes == ("rain",)


@pytest.mark.parametrize("bad", [-0.1, math.nan, math.inf])
@pytest.mark.parametrize("field", ["wind_mph", "rain_in_per_hr", "snow_in_per_hr"])
def test_conditions_reject_negative_and_non_finite_values(field: str, bad: float) -> None:
    values = {"wind_mph": 0.0, "rain_in_per_hr": 0.0, "snow_in_per_hr": 0.0, field: bad}

    with pytest.raises(ValueError, match=field):
        Conditions(**values)


@pytest.mark.parametrize("bad", [0, -1, math.nan, math.inf])
def test_load_must_be_a_positive_finite_weight(bad: float) -> None:
    with pytest.raises(ValueError, match="load_lb"):
        assess_checkpoint(Conditions(10, 0, 0), load_lb=bad)


def test_levels_are_ordered_and_labelled_as_in_the_specification() -> None:
    assert list(RiskLevel) == sorted(RiskLevel)
    assert [level.label for level in RiskLevel] == [
        "Low",
        "Moderate",
        "High",
        "Severe",
        "No Travel",
    ]
