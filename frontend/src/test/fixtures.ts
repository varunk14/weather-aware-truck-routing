import type { Checkpoint, Heatmap, PlannedRoute, RiskLevel, TripPlan } from "../lib/types";

/** A checkpoint with calm weather unless overridden. */
export function checkpoint(index: number, mile: number, overrides: Partial<Checkpoint> = {}) {
  const value: Checkpoint = {
    index,
    mile,
    lat: 47 - index * 0.5,
    lon: -122 + index * 0.5,
    eta: `2026-10-22T${String(8 + index).padStart(2, "0")}:00:00-07:00`,
    weather: { wind_mph: 6, gust_mph: 11, rain_in_hr: 0, snow_in_hr: 0 },
    risk: { level: "low", score: 0, wind: "low", rain: "low", snow: "low", causes: [] },
    ...overrides,
  };
  return value;
}

function miles(values: Partial<Record<RiskLevel, number>>): Record<RiskLevel, number> {
  return { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0, ...values };
}

function route(id: string, rank: number, overrides: Partial<PlannedRoute>): PlannedRoute {
  return {
    id,
    rank,
    distance_mi: 100,
    duration_s: 7_200,
    traffic_delay_s: 0,
    departure: "2026-10-22T08:00:00-07:00",
    arrival: "2026-10-22T10:00:00-07:00",
    detour: false,
    geometry: {
      type: "LineString",
      coordinates: [
        [-122, 47],
        [-121, 46],
      ],
    },
    risk: { miles: miles({ low: 100 }), average: 0, worst: "low" },
    checkpoints: [checkpoint(0, 0), checkpoint(1, 50), checkpoint(2, 100)],
    ...overrides,
  };
}

const rainy = checkpoint(1, 50, {
  weather: { wind_mph: 9, gust_mph: 20, rain_in_hr: 0.3, snow_in_hr: 0 },
  risk: { level: "high", score: 2, wind: "low", rain: "high", snow: "low", causes: ["rain"] },
});

const FRAMES = 50;

/**
 * Three cells along the trip. Frame i is 08:00 -07:00 plus i hours: the middle cell has High
 * rain from frame 3 to 5 and the last one has no forecast at frame 10.
 */
export function heatmap(overrides: Partial<Heatmap> = {}): Heatmap {
  const frames = (value: (i: number) => number | null) =>
    Array.from({ length: FRAMES }, (_, i) => value(i));
  const rainy = (i: number) => i >= 3 && i <= 5;
  return {
    start: "2026-10-22T15:00:00+00:00",
    frames: FRAMES,
    spacing_m: 20_000,
    cell_size: { lat: 0.5, lon: 0.5 },
    cells: [
      {
        lat: 47,
        lon: -122,
        risk: frames(() => 0),
        wind: frames((i) => i),
        rain: frames(() => 0),
        snow: frames(() => 0),
      },
      {
        lat: 46.5,
        lon: -121.5,
        risk: frames((i) => (rainy(i) ? 2 : 0)),
        wind: frames(() => 8),
        rain: frames((i) => (rainy(i) ? 0.3 : 0)),
        snow: frames(() => 0),
      },
      {
        lat: 46,
        lon: -121,
        risk: frames((i) => (i === 10 ? null : 0)),
        wind: frames((i) => (i === 10 ? null : 5)),
        rain: frames(() => 0),
        snow: frames(() => 0),
      },
    ],
    ...overrides,
  };
}

/** Three routes: A is fastest but crosses High rain, B is recommended, C is longest. */
export function tripPlan(overrides: Partial<TripPlan> = {}): TripPlan {
  return {
    origin: { title: "Seattle, WA", lat: 47.6, lon: -122.33 },
    destination: { title: "Salt Lake City, UT", lat: 40.76, lon: -111.89 },
    load_lb: 42_000,
    interval_mi: 25,
    routes: [
      route("A", 3, {
        distance_mi: 846.7,
        duration_s: 43_380,
        arrival: "2026-10-22T21:03:00-06:00",
        risk: { miles: miles({ low: 796.7, high: 50 }), average: 0.118, worst: "high" },
        checkpoints: [checkpoint(0, 0), rainy, checkpoint(2, 100)],
      }),
      route("B", 1, {
        distance_mi: 1020.9,
        duration_s: 54_600,
        arrival: "2026-10-23T00:10:00-06:00",
        risk: { miles: miles({ low: 995.9, moderate: 25 }), average: 0.024, worst: "moderate" },
      }),
      route("C", 2, {
        distance_mi: 1051.3,
        duration_s: 61_380,
        arrival: "2026-10-23T02:02:00-06:00",
        detour: true,
        risk: { miles: miles({ low: 1025.6, high: 25.7 }), average: 0.05, worst: "high" },
      }),
    ],
    recommendation: {
      route_id: "B",
      reason:
        "Avoids 50 mi of High-risk weather on the fastest route (Route A), for 3 h 07 min more driving.",
      safe: true,
    },
    notes: [],
    heatmap: heatmap(),
    ...overrides,
  };
}
