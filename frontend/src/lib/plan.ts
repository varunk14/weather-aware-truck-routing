import type { Checkpoint, PlannedRoute, RouteRisk, TripPlan } from "./types";

/** Routes from best to worst, as ranked by the API. */
export function rankedRoutes(plan: TripPlan): PlannedRoute[] {
  return [...plan.routes].sort((a, b) => a.rank - b.rank);
}

export function routeById(plan: TripPlan, id: string | null): PlannedRoute | undefined {
  return plan.routes.find((route) => route.id === id);
}

/** Miles in Severe or No Travel conditions. */
export function severePlusMiles(risk: RouteRisk): number {
  return risk.miles.severe + risk.miles.no_travel;
}

/** Checkpoints above Low risk, in driving order. */
export function hazards(route: PlannedRoute): Checkpoint[] {
  return route.checkpoints.filter((checkpoint) => checkpoint.risk.level !== "low");
}

/**
 * Miles of road a checkpoint stands for: from halfway back to the previous checkpoint to halfway
 * forward to the next one (the same rule the API uses for route scores).
 */
export function coveredMiles(checkpoints: readonly Checkpoint[], index: number): number {
  const current = checkpoints[index];
  if (!current) return 0;
  const previous = checkpoints[index - 1];
  const next = checkpoints[index + 1];
  const start = previous ? (previous.mile + current.mile) / 2 : 0;
  const end = next ? (current.mile + next.mile) / 2 : current.mile;
  return end - start;
}
