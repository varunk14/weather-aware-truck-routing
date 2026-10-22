import { describe, expect, it } from "vitest";

import type { PlannedRoute } from "../../lib/types";
import { checkpoint, tripPlan } from "../../test/fixtures";
import { truckAt } from "./truck";

/**
 * A 100 mi route from (-122, 47) to (-121, 46), with checkpoints at miles 0, 50 and 100 reached
 * at 08:00, 09:00 and 10:00 -07:00.
 */
function route(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  const base = tripPlan().routes[1];
  if (!base) throw new Error("The fixture has no Route B.");
  return {
    ...base,
    distance_mi: 100,
    arrival: "2026-10-22T10:00:00-07:00",
    checkpoints: [checkpoint(0, 0), checkpoint(1, 50), checkpoint(2, 100)],
    ...overrides,
  };
}

describe("truckAt", () => {
  it("starts at the origin", () => {
    expect(truckAt(route(), 0)).toEqual({
      lngLat: [-122, 47],
      mile: 0,
      status: "driving",
      facing: "right",
    });
  });

  it("moves between checkpoints at the pace their arrival times give", () => {
    const early = truckAt(route(), 0.5);
    expect(early.mile).toBe(25);
    expect(early.lngLat[0]).toBeCloseTo(-121.75, 2);
    expect(early.lngLat[1]).toBeCloseTo(46.75, 2);

    expect(truckAt(route(), 1.5).mile).toBe(75);
  });

  it("follows an uneven pace: slow traffic before a checkpoint, then faster", () => {
    const slow = route({
      checkpoints: [checkpoint(0, 0), checkpoint(1, 20), checkpoint(2, 100)],
    });
    expect(truckAt(slow, 1).mile).toBe(20);
    expect(truckAt(slow, 1.5).mile).toBe(60);
  });

  it("waits at the destination once it has arrived", () => {
    expect(truckAt(route(), 2)).toEqual({
      lngLat: [-121, 46],
      mile: 100,
      status: "arrived",
      facing: "right",
    });
    expect(truckAt(route(), 30).status).toBe("arrived");
  });

  it("faces the way it drives: left on a westbound route", () => {
    const westbound = route({
      geometry: {
        type: "LineString",
        coordinates: [
          [-121, 46],
          [-122, 47],
        ],
      },
    });

    expect(truckAt(westbound, 0.5).facing).toBe("left");
    expect(truckAt(westbound, 5).facing).toBe("left");
    expect(truckAt(route(), 0.5).facing).toBe("right");
  });

  it("follows a bend: right, then left after a U-turn", () => {
    const bend = route({
      geometry: {
        type: "LineString",
        coordinates: [
          [-122, 47],
          [-121, 47],
          [-122, 46.9],
        ],
      },
    });

    expect(truckAt(bend, 0.5).facing).toBe("right");
    expect(truckAt(bend, 1.75).facing).toBe("left");
  });

  it("keeps its direction through a short bend at the destination", () => {
    const hook = route({
      geometry: {
        type: "LineString",
        coordinates: [
          [-121, 46],
          [-122, 47],
          [-121.99, 47],
        ],
      },
    });

    expect(truckAt(hook, 1.9).facing).toBe("left");
    expect(truckAt(hook, 2).facing).toBe("left");
  });
});
