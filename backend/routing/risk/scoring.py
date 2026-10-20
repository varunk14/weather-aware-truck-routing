"""Route-level risk numbers built from checkpoint risk."""

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise

from routing.risk.levels import RiskLevel


def checkpoint_coverage(distances_mi: Sequence[float], total_mi: float) -> list[float]:
    """Miles of road each checkpoint represents.

    A checkpoint covers the road from halfway back to the previous checkpoint to halfway
    forward to the next one. The first starts at the origin and the last ends at the
    destination, so the covered lengths add up to the route length.
    """
    if not math.isfinite(total_mi) or total_mi <= 0:
        raise ValueError(f"total_mi must be a finite number above zero, got {total_mi!r}")
    if not distances_mi:
        raise ValueError("At least one checkpoint is required.")
    if any(later < earlier for earlier, later in pairwise(distances_mi)):
        raise ValueError("Checkpoint distances must be in ascending order.")
    if distances_mi[0] < 0 or distances_mi[-1] > total_mi:
        raise ValueError("Checkpoint distances must lie between the origin and the destination.")

    edges = [0.0, *((a + b) / 2 for a, b in pairwise(distances_mi)), total_mi]
    return [end - start for start, end in pairwise(edges)]


@dataclass(frozen=True, slots=True)
class RiskSegment:
    """A stretch of road and the risk level of the checkpoint that represents it."""

    miles: float
    level: RiskLevel


@dataclass(frozen=True, slots=True)
class RouteRisk:
    """Miles of a route at each risk level, indexed by ``RiskLevel``."""

    miles_by_level: tuple[float, float, float, float, float]

    @classmethod
    def from_segments(cls, segments: Iterable[RiskSegment]) -> "RouteRisk":
        totals = [0.0] * len(RiskLevel)
        for segment in segments:
            if not math.isfinite(segment.miles) or segment.miles < 0:
                raise ValueError(f"Segment miles must be zero or more, got {segment.miles!r}")
            totals[segment.level] += segment.miles
        if sum(totals) <= 0:
            raise ValueError("A route needs at least one segment with a positive length.")
        low, moderate, high, severe, no_travel = totals
        return cls((low, moderate, high, severe, no_travel))

    def miles(self, level: RiskLevel) -> float:
        return self.miles_by_level[level]

    @property
    def total_miles(self) -> float:
        return sum(self.miles_by_level)

    @property
    def no_travel_miles(self) -> float:
        return self.miles(RiskLevel.NO_TRAVEL)

    @property
    def severe_miles(self) -> float:
        return self.miles(RiskLevel.SEVERE)

    @property
    def high_miles(self) -> float:
        return self.miles(RiskLevel.HIGH)

    @property
    def average_risk(self) -> float:
        """Mean level score (Low 0 to No Travel 4), weighted by miles."""
        weighted = sum(level * self.miles(level) for level in RiskLevel)
        return weighted / self.total_miles

    @property
    def worst_level(self) -> RiskLevel:
        return max(level for level in RiskLevel if self.miles(level) > 0)
