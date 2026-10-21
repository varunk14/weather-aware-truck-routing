/**
 * GeoJSON for the map's sources, built from a trip plan. Pure functions, so what the map shows
 * can be tested without a browser.
 */

import type { PlannedRoute, RiskLevel, TripPlan } from "../../lib/types";

export type Position = [number, number];
export type Bounds = [Position, Position];

interface Feature<G, P> {
  type: "Feature";
  geometry: G;
  properties: P;
}

export interface FeatureCollection<G, P> {
  type: "FeatureCollection";
  features: Feature<G, P>[];
}

interface LineString {
  type: "LineString";
  coordinates: Position[];
}

interface Point {
  type: "Point";
  coordinates: Position;
}

export type RoutesData = FeatureCollection<LineString, { id: string; selected: boolean }>;
export type CheckpointsData = FeatureCollection<
  Point,
  { index: number; level: RiskLevel; selected: boolean }
>;
export type EndpointsData = FeatureCollection<Point, { kind: "origin" | "destination" }>;

export function emptyData<G, P>(): FeatureCollection<G, P> {
  return { type: "FeatureCollection", features: [] };
}

/** Every route, with the selected one last so it is drawn on top. */
export function routesData(plan: TripPlan | null, selectedId: string | null): RoutesData {
  if (!plan) return emptyData();
  const ordered = [...plan.routes].sort(
    (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
  );
  return {
    type: "FeatureCollection",
    features: ordered.map((route) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route.geometry.coordinates },
      properties: { id: route.id, selected: route.id === selectedId },
    })),
  };
}

/** The checkpoints of one route; the selected checkpoint is marked and drawn last. */
export function checkpointsData(
  route: PlannedRoute | undefined,
  selectedIndex: number | null,
): CheckpointsData {
  if (!route) return emptyData();
  const ordered = [...route.checkpoints].sort(
    (a, b) => Number(a.index === selectedIndex) - Number(b.index === selectedIndex),
  );
  return {
    type: "FeatureCollection",
    features: ordered.map((checkpoint) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [checkpoint.lon, checkpoint.lat] },
      properties: {
        index: checkpoint.index,
        level: checkpoint.risk.level,
        selected: checkpoint.index === selectedIndex,
      },
    })),
  };
}

export function endpointsData(plan: TripPlan | null): EndpointsData {
  if (!plan) return emptyData();
  const point = (lon: number, lat: number): Point => ({ type: "Point", coordinates: [lon, lat] });
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: point(plan.origin.lon, plan.origin.lat),
        properties: { kind: "origin" },
      },
      {
        type: "Feature",
        geometry: point(plan.destination.lon, plan.destination.lat),
        properties: { kind: "destination" },
      },
    ],
  };
}

/** South-west and north-east corners around all the coordinates. */
export function boundsOf(coordinates: readonly Position[]): Bounds | null {
  const first = coordinates[0];
  if (!first) return null;
  let [west, south] = first;
  let [east, north] = first;
  for (const [lon, lat] of coordinates) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

export function planBounds(plan: TripPlan): Bounds | null {
  return boundsOf(plan.routes.flatMap((route) => route.geometry.coordinates));
}
