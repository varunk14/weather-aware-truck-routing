"""Weather risk rules: checkpoint classification, route scoring and route ranking.

Pure Python with no framework or network dependencies, so every rule is unit-testable.
"""

from routing.risk.classification import (
    CheckpointRisk,
    Conditions,
    assess_checkpoint,
    wind_level_for_load,
)
from routing.risk.levels import RiskLevel
from routing.risk.ranking import Recommendation, RouteOption, rank_routes, recommend
from routing.risk.scoring import RiskSegment, RouteRisk, checkpoint_coverage

__all__ = [
    "CheckpointRisk",
    "Conditions",
    "Recommendation",
    "RiskLevel",
    "RiskSegment",
    "RouteOption",
    "RouteRisk",
    "assess_checkpoint",
    "checkpoint_coverage",
    "rank_routes",
    "recommend",
    "wind_level_for_load",
]
