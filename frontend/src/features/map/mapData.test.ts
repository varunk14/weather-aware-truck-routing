import { describe, expect, it } from "vitest";

import { tripPlan } from "../../test/fixtures";
import {
  boundsOf,
  checkpointsData,
  emptyData,
  endpointsData,
  planBounds,
  routesData,
} from "./mapData";

describe("routesData", () => {
  it("draws every route and puts the selected one last, on top", () => {
    const data = routesData(tripPlan(), "A");

    expect(data.features.map((feature) => feature.properties)).toEqual([
      { id: "B", selected: false },
      { id: "C", selected: false },
      { id: "A", selected: true },
    ]);
    expect(data.features[2]?.geometry.coordinates).toEqual([
      [-122, 47],
      [-121, 46],
    ]);
  });

  it("is empty without a plan", () => {
    expect(routesData(null, null)).toEqual(emptyData());
  });
});

describe("checkpointsData", () => {
  it("colours checkpoints by level and marks the selected one, drawn last", () => {
    const route = tripPlan().routes[0];

    const data = checkpointsData(route, 1);

    expect(data.features.map((feature) => feature.properties)).toEqual([
      { index: 0, level: "low", selected: false },
      { index: 2, level: "low", selected: false },
      { index: 1, level: "high", selected: true },
    ]);
    expect(data.features[2]?.geometry).toEqual({ type: "Point", coordinates: [-121.5, 46.5] });
  });

  it("is empty without a route", () => {
    expect(checkpointsData(undefined, null).features).toEqual([]);
  });
});

describe("endpointsData", () => {
  it("marks the origin and destination", () => {
    expect(endpointsData(tripPlan()).features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-122.33, 47.6] },
        properties: { kind: "origin" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-111.89, 40.76] },
        properties: { kind: "destination" },
      },
    ]);
    expect(endpointsData(null).features).toEqual([]);
  });
});

describe("bounds", () => {
  it("encloses every coordinate", () => {
    expect(
      boundsOf([
        [-100, 40],
        [-90, 45],
        [-95, 30],
      ]),
    ).toEqual([
      [-100, 30],
      [-90, 45],
    ]);
    expect(boundsOf([])).toBeNull();
  });

  it("covers all routes of a plan", () => {
    expect(planBounds(tripPlan())).toEqual([
      [-122, 46],
      [-121, 47],
    ]);
  });
});
