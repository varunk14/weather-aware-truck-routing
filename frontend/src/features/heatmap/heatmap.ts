/**
 * The corridor heatmap as map data and paint expressions. Pure functions, so what the slider
 * shows at any hour can be tested without a browser.
 *
 * Every cell is a square, and squares tile the corridor without overlapping, so each place shows
 * its own level and nothing adds up where cells meet. All frames are uploaded to the map once,
 * as properties of each cell (r0..r49 for risk, w, p and s for wind, rain and snow). Moving the slider only builds a new colour expression that
 * reads other properties: nothing is uploaded again and nothing is fetched.
 */

import type { ExpressionSpecification } from "maplibre-gl";

import { RISK_COLORS, RISK_LEVELS } from "../../lib/risk";
import type { Heatmap } from "../../lib/types";

export type HeatLayer = "risk" | "wind" | "rain" | "snow";
export type WeatherLayer = Exclude<HeatLayer, "risk">;

export const HEAT_LAYERS: readonly HeatLayer[] = ["risk", "wind", "rain", "snow"];
export const HEAT_LAYER_LABELS: Record<HeatLayer, string> = {
  risk: "Risk",
  wind: "Wind",
  rain: "Rain",
  snow: "Snow",
};

/** The slider runs from departure to 48 hours later. */
export const MAX_HOUR = 48;

/** "+6 h", "+6.5 h": the slider's time after departure. */
export function formatHoursAhead(hour: number): string {
  const rounded = Math.round(hour * 10) / 10;
  return `+${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} h`;
}

const PREFIX: Record<HeatLayer, string> = { risk: "r", wind: "w", rain: "p", snow: "s" };
const HOUR_MS = 3_600_000;
const TRANSPARENT = "rgba(0, 0, 0, 0)";

export interface Ramp {
  /** Values at which the colour is given, in the layer's unit. */
  stops: readonly number[];
  colors: readonly string[];
  unit: string;
}

// Wind: sky to blue to indigo; rain: aqua to teal; snow: lavender to violet (UI direction).
// Above the first faint stop, the stops are the risk thresholds, so the colour bands line up
// with the risk levels.
export const RAMPS: Record<WeatherLayer, Ramp> = {
  wind: {
    stops: [0, 15, 25, 35, 45, 55],
    colors: [
      "rgba(125, 211, 252, 0)",
      "rgba(125, 211, 252, 0.45)",
      "rgba(56, 152, 236, 0.6)",
      "rgba(37, 99, 235, 0.7)",
      "rgba(55, 48, 163, 0.8)",
      "rgba(30, 27, 105, 0.85)",
    ],
    unit: "mph",
  },
  rain: {
    stops: [0, 0.02, 0.1, 0.25, 0.5, 1],
    colors: [
      "rgba(103, 232, 249, 0)",
      "rgba(103, 232, 249, 0.4)",
      "rgba(34, 184, 207, 0.55)",
      "rgba(13, 148, 136, 0.7)",
      "rgba(15, 118, 110, 0.8)",
      "rgba(17, 78, 74, 0.85)",
    ],
    unit: "in/hr",
  },
  snow: {
    stops: [0, 0.1, 0.5, 1, 2, 3],
    colors: [
      "rgba(221, 214, 254, 0)",
      "rgba(221, 214, 254, 0.5)",
      "rgba(196, 181, 253, 0.6)",
      "rgba(167, 139, 250, 0.7)",
      "rgba(124, 58, 237, 0.8)",
      "rgba(76, 29, 149, 0.85)",
    ],
    unit: "in/hr",
  },
};

/** Low cells are drawn lighter, so the eye goes to the cells that matter. */
export const RISK_OPACITY = [0.16, 0.42, 0.5, 0.58, 0.62] as const;

export interface FramePosition {
  /** Frame at or before the moment. */
  before: number;
  /** Frame after it (the same at the last frame). */
  after: number;
  /** How far the moment is from ``before`` towards ``after``, 0 to 1. */
  fraction: number;
  /** The frame whose hour holds the moment, used for risk (as for rain at checkpoints). */
  holding: number;
}

/** Where ``hours`` after ``departure`` falls among the heatmap's frames. */
export function framePosition(heatmap: Heatmap, departure: string, hours: number): FramePosition {
  const last = Math.max(heatmap.frames - 1, 0);
  const offset = (Date.parse(departure) + hours * HOUR_MS - Date.parse(heatmap.start)) / HOUR_MS;
  const clamped = Math.min(Math.max(offset, 0), last);
  const before = Math.floor(clamped);
  return {
    before,
    after: Math.min(before + 1, last),
    fraction: clamped - before,
    holding: Math.max(0, Math.min(Math.ceil(clamped - 1e-9), last)),
  };
}

type CellProperties = Record<string, number | null>;

interface CellFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: CellProperties;
}

export interface HeatmapData {
  type: "FeatureCollection";
  features: CellFeature[];
}

/** One square per cell, carrying every frame. */
export function heatmapData(heatmap: Heatmap | null): HeatmapData {
  if (!heatmap) return { type: "FeatureCollection", features: [] };
  const halfLat = heatmap.cell_size.lat / 2;
  const halfLon = heatmap.cell_size.lon / 2;
  return {
    type: "FeatureCollection",
    features: heatmap.cells.map((cell) => {
      const properties: CellProperties = {};
      for (let i = 0; i < heatmap.frames; i += 1) {
        properties[`r${String(i)}`] = cell.risk[i] ?? null;
        properties[`w${String(i)}`] = cell.wind[i] ?? null;
        properties[`p${String(i)}`] = cell.rain[i] ?? null;
        properties[`s${String(i)}`] = cell.snow[i] ?? null;
      }
      const [west, east] = [cell.lon - halfLon, cell.lon + halfLon];
      const [south, north] = [cell.lat - halfLat, cell.lat + halfLat];
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
        properties,
      };
    }),
  };
}

const property = (layer: HeatLayer, frame: number) => `${PREFIX[layer]}${String(frame)}`;

/** The colour of every cell for ``layer`` at ``position``. */
export function colorExpression(
  layer: HeatLayer,
  position: FramePosition,
): ExpressionSpecification {
  if (layer === "risk") {
    return [
      "match",
      ["coalesce", ["get", property("risk", position.holding)], -1],
      ...RISK_LEVELS.flatMap((level, score) => [score, RISK_COLORS[level]]),
      TRANSPARENT,
    ] as unknown as ExpressionSpecification;
  }
  const a = ["get", property(layer, position.before)];
  const b = ["get", property(layer, position.after)];
  const value = ["+", ["*", a, 1 - position.fraction], ["*", b, position.fraction]];
  const ramp = RAMPS[layer];
  return [
    "case",
    ["any", ["==", a, null], ["==", b, null]],
    TRANSPARENT,
    ["interpolate", ["linear"], value, ...ramp.stops.flatMap((stop, i) => [stop, ramp.colors[i]])],
  ] as unknown as ExpressionSpecification;
}

/** Cell opacity: lighter Low cells for risk; the ramps carry their own transparency. */
export function opacityExpression(
  layer: HeatLayer,
  position: FramePosition,
): ExpressionSpecification | number {
  if (layer !== "risk") return 1;
  return [
    "match",
    ["coalesce", ["get", property("risk", position.holding)], -1],
    ...RISK_OPACITY.flatMap((opacity, score) => [score, opacity]),
    0,
  ] as unknown as ExpressionSpecification;
}
