/**
 * Where the truck is on a route at a given time, from the checkpoints' arrival times: the mile
 * is interpolated between the two checkpoints around that time, then found on the route line.
 */

import type { PlannedRoute } from "../../lib/types";

export interface TruckPosition {
  lngLat: [number, number];
  mile: number;
  status: "driving" | "arrived";
  /** Which way the truck points on the map, so it never drives backwards. */
  facing: "left" | "right";
}

const EARTH_RADIUS_MI = 3_958.8;
const HOUR_MS = 3_600_000;
const RADIANS = Math.PI / 180;

function distanceMi(a: [number, number], b: [number, number]): number {
  const lat1 = a[1] * RADIANS;
  const lat2 = b[1] * RADIANS;
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(((b[0] - a[0]) * RADIANS) / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/** The truck ``hours`` after the route's departure. */
export function truckAt(route: PlannedRoute, hours: number): TruckPosition {
  const moment = Date.parse(route.departure) + hours * HOUR_MS;
  const { checkpoints } = route;
  const coordinates = route.geometry.coordinates;
  const end = coordinates[coordinates.length - 1] ?? [0, 0];
  const last = checkpoints[checkpoints.length - 1];
  if (!last || moment >= Date.parse(last.eta) || moment >= Date.parse(route.arrival)) {
    const mile = route.distance_mi;
    return { lngLat: end, mile, status: "arrived", facing: facingAt(route, mile) };
  }

  let mile = 0;
  for (let i = 1; i < checkpoints.length; i += 1) {
    const before = checkpoints[i - 1];
    const after = checkpoints[i];
    if (!before || !after) continue;
    const t0 = Date.parse(before.eta);
    const t1 = Date.parse(after.eta);
    if (moment <= t1) {
      const share = t1 > t0 ? Math.max(0, (moment - t0) / (t1 - t0)) : 1;
      mile = before.mile + (after.mile - before.mile) * share;
      break;
    }
  }
  return {
    lngLat: pointAtMile(coordinates, mile, route.distance_mi),
    mile,
    status: "driving",
    facing: facingAt(route, mile),
  };
}

/**
 * Left or right on the map, from the road behind the truck to the road ahead. The stretch is
 * 2% of the trip each way, so a short bend in a city street does not turn the truck around.
 */
function facingAt(route: PlannedRoute, mile: number): "left" | "right" {
  const routeMi = route.distance_mi;
  const step = Math.max(routeMi / 50, 1);
  const coordinates = route.geometry.coordinates;
  const behind = pointAtMile(coordinates, Math.max(mile - step, 0), routeMi);
  const ahead = pointAtMile(coordinates, Math.min(mile + step, routeMi), routeMi);
  return ahead[0] < behind[0] ? "left" : "right";
}

interface Segment {
  from: [number, number];
  to: [number, number];
  length: number;
}

interface Measured {
  segments: Segment[];
  total: number;
}

// A route's line is measured once, not on every move of the slider.
const measured = new WeakMap<[number, number][], Measured>();

function measure(coordinates: [number, number][]): Measured {
  const known = measured.get(coordinates);
  if (known) return known;
  const segments: Segment[] = [];
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const from = coordinates[i - 1];
    const to = coordinates[i];
    if (!from || !to) continue;
    const length = distanceMi(from, to);
    segments.push({ from, to, length });
    total += length;
  }
  const result = { segments, total };
  measured.set(coordinates, result);
  return result;
}

/**
 * The point ``mile`` miles along the line. The simplified line is a little shorter than the
 * road, so its length is scaled to the route's distance first.
 */
function pointAtMile(
  coordinates: [number, number][],
  mile: number,
  routeMi: number,
): [number, number] {
  const { segments, total } = measure(coordinates);
  const first = coordinates[0] ?? [0, 0];
  if (total === 0 || routeMi <= 0) return first;

  let remaining = (mile / routeMi) * total;
  for (const { from, to, length } of segments) {
    if (remaining <= length) {
      const share = length > 0 ? remaining / length : 0;
      return [from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share];
    }
    remaining -= length;
  }
  return coordinates[coordinates.length - 1] ?? first;
}
