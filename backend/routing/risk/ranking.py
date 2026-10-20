"""Ranking routes and explaining the recommendation.

Routes are compared on, in order: miles in No Travel conditions, miles in Severe weather,
miles in High-risk weather, distance-weighted average risk, and travel time. Miles are compared
to the nearest 0.1 mi and average risk to three decimals, so floating-point noise never decides
between two otherwise equal routes. Remaining ties keep the order the routes were given in.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from routing.risk.scoring import RouteRisk

MILES_DECIMALS = 1
RISK_DECIMALS = 3


@dataclass(frozen=True, slots=True)
class RouteOption:
    route_id: str
    duration_s: float
    risk: RouteRisk


@dataclass(frozen=True, slots=True)
class Recommendation:
    best: RouteOption
    ranked: tuple[RouteOption, ...]
    reason: str

    @property
    def is_safe(self) -> bool:
        """False when every route, including the best one, crosses No Travel conditions."""
        return _miles(self.best.risk.no_travel_miles) == 0


def ranking_key(option: RouteOption) -> tuple[float, float, float, float, float]:
    risk = option.risk
    return (
        _miles(risk.no_travel_miles),
        _miles(risk.severe_miles),
        _miles(risk.high_miles),
        round(risk.average_risk, RISK_DECIMALS),
        option.duration_s,
    )


def rank_routes(options: Sequence[RouteOption]) -> list[RouteOption]:
    """Routes from best to worst. ``sorted`` is stable, so full ties keep their input order."""
    if not options:
        raise ValueError("At least one route is required.")
    ids = [option.route_id for option in options]
    if len(set(ids)) != len(ids):
        raise ValueError(f"Route ids must be unique, got {ids}")
    return sorted(options, key=ranking_key)


def recommend(options: Sequence[RouteOption]) -> Recommendation:
    ranked = rank_routes(options)
    best = ranked[0]
    fastest = min(options, key=lambda option: option.duration_s)
    return Recommendation(best=best, ranked=tuple(ranked), reason=explain(best, fastest))


_HAZARDS: tuple[tuple[str, Callable[[RouteRisk], float]], ...] = (
    ("No Travel conditions", lambda risk: risk.no_travel_miles),
    ("Severe weather", lambda risk: risk.severe_miles),
    ("High-risk weather", lambda risk: risk.high_miles),
)


def explain(best: RouteOption, fastest: RouteOption) -> str:
    """One sentence on why ``best`` was chosen, compared with the fastest route."""
    if _miles(best.risk.no_travel_miles) > 0:
        return (
            f"Every route crosses No Travel conditions. Route {best.route_id} has the fewest "
            f"({format_miles(best.risk.no_travel_miles)}); consider a later departure."
        )
    if best.duration_s <= fastest.duration_s:
        return "Fastest route, and no other route has less weather risk."

    extra = format_duration(best.duration_s - fastest.duration_s)
    return f"{_advantage(best.risk, fastest)}, for {extra} more driving."


def _advantage(risk: RouteRisk, fastest: RouteOption) -> str:
    than = f"the fastest route (Route {fastest.route_id})"
    for hazard, miles_of in _HAZARDS:
        ours, theirs = _miles(miles_of(risk)), _miles(miles_of(fastest.risk))
        if ours < theirs:
            if ours == 0:
                return f"Avoids {format_miles(theirs)} of {hazard} on {than}"
            return f"Has {format_miles(theirs - ours)} less {hazard} than {than}"
    return (
        f"Lower average weather risk than {than}: "
        f"{risk.average_risk:.2f} vs {fastest.risk.average_risk:.2f}"
    )


def format_miles(miles: float) -> str:
    rounded = _miles(miles)
    if rounded >= 10 or rounded.is_integer():
        return f"{rounded:,.0f} mi"
    return f"{rounded:.1f} mi"


def format_duration(seconds: float) -> str:
    hours, minutes = divmod(round(seconds / 60), 60)
    return f"{hours} h {minutes:02d} min" if hours else f"{minutes} min"


def _miles(miles: float) -> float:
    return round(miles, MILES_DECIMALS)
