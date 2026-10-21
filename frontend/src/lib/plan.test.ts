import { describe, expect, it } from "vitest";

import { checkpoint, tripPlan } from "../test/fixtures";
import { coveredMiles, hazards, rankedRoutes, routeById, severePlusMiles } from "./plan";

describe("plan helpers", () => {
  it("orders routes by rank and finds them by id", () => {
    const plan = tripPlan();

    expect(rankedRoutes(plan).map((route) => route.id)).toEqual(["B", "C", "A"]);
    expect(routeById(plan, "C")?.distance_mi).toBe(1051.3);
    expect(routeById(plan, null)).toBeUndefined();
  });

  it("adds Severe and No Travel miles together", () => {
    expect(
      severePlusMiles({
        miles: { low: 10, moderate: 0, high: 0, severe: 12.5, no_travel: 2 },
        average: 0,
        worst: "no_travel",
      }),
    ).toBe(14.5);
  });

  it("lists only checkpoints above Low risk", () => {
    const route = rankedRoutes(tripPlan()).at(-1);
    if (!route) throw new Error("The fixture has no routes.");

    expect(hazards(route).map((item) => item.index)).toEqual([1]);
  });

  it("splits the road halfway between checkpoints, like the API's route score", () => {
    // Checkpoints at mile 0, 25, 50 and 60 of a 60 mile route.
    const checkpoints = [0, 25, 50, 60].map((mile, index) => checkpoint(index, mile));

    expect(checkpoints.map((_, index) => coveredMiles(checkpoints, index))).toEqual([
      12.5, 25, 17.5, 5,
    ]);
    expect(coveredMiles(checkpoints, 7)).toBe(0);
  });
});
