"""Checkpoint risk from the specification's weather thresholds and load rules.

Each band includes its lower bound and excludes its upper bound, so a value on an edge shared
by two bands belongs to the higher one. The No Travel band keeps the table's own wording: wind
of 55 mph or more, rain above 1.00 in/hr and snow above 3.0 in/hr.
"""

import math
from dataclasses import dataclass

from routing.risk.levels import RiskLevel


@dataclass(frozen=True, slots=True)
class Thresholds:
    """Lower bounds of the Moderate, High and Severe bands, and the No Travel limit.

    ``no_travel_at_limit`` says whether a value exactly at the limit is already No Travel.
    """

    moderate: float
    high: float
    severe: float
    no_travel: float
    no_travel_at_limit: bool

    def classify(self, value: float) -> RiskLevel:
        _require_non_negative("value", value)
        if value > self.no_travel or (self.no_travel_at_limit and value == self.no_travel):
            return RiskLevel.NO_TRAVEL
        if value >= self.severe:
            return RiskLevel.SEVERE
        if value >= self.high:
            return RiskLevel.HIGH
        if value >= self.moderate:
            return RiskLevel.MODERATE
        return RiskLevel.LOW


WIND_MPH = Thresholds(moderate=25, high=35, severe=45, no_travel=55, no_travel_at_limit=True)
RAIN_IN_PER_HR = Thresholds(
    moderate=0.10, high=0.25, severe=0.50, no_travel=1.00, no_travel_at_limit=False
)
SNOW_IN_PER_HR = Thresholds(
    moderate=0.5, high=1.0, severe=2.0, no_travel=3.0, no_travel_at_limit=False
)

# Load rules: loads above these weights make strong wind more dangerous.
HEAVY_LOAD_LB = 30_000  # Severe wind (45 to 54 mph) becomes No Travel.
VERY_HEAVY_LOAD_LB = 40_000  # High wind (35 to 44 mph) becomes Severe.


@dataclass(frozen=True, slots=True)
class Conditions:
    """Forecast at a checkpoint for the hour the truck is expected to arrive there."""

    wind_mph: float
    rain_in_per_hr: float
    snow_in_per_hr: float

    def __post_init__(self) -> None:
        _require_non_negative("wind_mph", self.wind_mph)
        _require_non_negative("rain_in_per_hr", self.rain_in_per_hr)
        _require_non_negative("snow_in_per_hr", self.snow_in_per_hr)


@dataclass(frozen=True, slots=True)
class CheckpointRisk:
    """Risk at one checkpoint: the overall level and the level of each condition."""

    level: RiskLevel
    wind: RiskLevel
    rain: RiskLevel
    snow: RiskLevel
    raised_by_load: bool

    @property
    def causes(self) -> tuple[str, ...]:
        """The factors that set the overall level, for explaining it to the driver."""
        if self.raised_by_load:
            return ("wind", "load")
        if self.level == RiskLevel.LOW:
            return ()
        by_condition = (("wind", self.wind), ("rain", self.rain), ("snow", self.snow))
        return tuple(name for name, level in by_condition if level == self.level)


def wind_level_for_load(wind_mph: float, load_lb: float) -> RiskLevel:
    """Wind level after the load rules. The rules only ever raise the level."""
    _require_positive("load_lb", load_lb)
    level = WIND_MPH.classify(wind_mph)
    if level == RiskLevel.SEVERE and load_lb > HEAVY_LOAD_LB:
        return RiskLevel.NO_TRAVEL
    if level == RiskLevel.HIGH and load_lb > VERY_HEAVY_LOAD_LB:
        return RiskLevel.SEVERE
    return level


def assess_checkpoint(conditions: Conditions, load_lb: float) -> CheckpointRisk:
    """Classify each condition, take the worst, then apply the load rules."""
    wind = WIND_MPH.classify(conditions.wind_mph)
    rain = RAIN_IN_PER_HR.classify(conditions.rain_in_per_hr)
    snow = SNOW_IN_PER_HR.classify(conditions.snow_in_per_hr)
    weather = max(wind, rain, snow)
    level = max(weather, wind_level_for_load(conditions.wind_mph, load_lb))
    return CheckpointRisk(
        level=level, wind=wind, rain=rain, snow=snow, raised_by_load=level > weather
    )


def _require_non_negative(name: str, value: float) -> None:
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be a finite number of zero or more, got {value!r}")


def _require_positive(name: str, value: float) -> None:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a finite number above zero, got {value!r}")
