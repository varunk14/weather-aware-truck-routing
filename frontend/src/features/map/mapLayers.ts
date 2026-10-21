import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

import { RISK_COLORS, RISK_LEVELS } from "../../lib/risk";
import { emptyData } from "./mapData";

export const SOURCES = {
  routes: "clearway-routes",
  checkpoints: "clearway-checkpoints",
  endpoints: "clearway-endpoints",
} as const;

export const LAYERS = {
  routeAlternative: "clearway-route-alternative",
  routeAlternativeHit: "clearway-route-alternative-hit",
  routeCasing: "clearway-route-casing",
  routeSelected: "clearway-route-selected",
  checkpoints: "clearway-checkpoints",
  checkpointHit: "clearway-checkpoint-hit",
  endpoints: "clearway-endpoints",
} as const;

const NAVY = "#0d1e2d";
const ALTERNATIVE = "#9aa8b3";
const WHITE = "#ffffff";

const riskColor = [
  "match",
  ["get", "level"],
  ...RISK_LEVELS.flatMap((level) => [level, RISK_COLORS[level]]),
  RISK_COLORS.low,
] as unknown as ExpressionSpecification;

const isSelected: ExpressionSpecification = ["==", ["get", "selected"], true];
const isAlternative: ExpressionSpecification = ["==", ["get", "selected"], false];
const lineLayout = { "line-cap": "round", "line-join": "round" } as const;

/**
 * Adds the trip's sources and layers. Route lines go under the basemap's labels so place names
 * stay readable; checkpoints and endpoints go on top so they are easy to see and tap.
 */
export function addPlanLayers(map: MapLibreMap): void {
  const labels = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

  for (const id of Object.values(SOURCES)) {
    map.addSource(id, { type: "geojson", data: emptyData() });
  }

  map.addLayer(
    {
      id: LAYERS.routeAlternative,
      type: "line",
      source: SOURCES.routes,
      filter: isAlternative,
      layout: lineLayout,
      paint: { "line-color": ALTERNATIVE, "line-width": 4 },
    },
    labels,
  );
  map.addLayer(
    {
      id: LAYERS.routeAlternativeHit,
      type: "line",
      source: SOURCES.routes,
      filter: isAlternative,
      layout: lineLayout,
      // Invisible and wide, so a thin line is still easy to tap.
      paint: { "line-color": ALTERNATIVE, "line-width": 20, "line-opacity": 0 },
    },
    labels,
  );
  map.addLayer(
    {
      id: LAYERS.routeCasing,
      type: "line",
      source: SOURCES.routes,
      filter: isSelected,
      layout: lineLayout,
      paint: { "line-color": WHITE, "line-width": 8 },
    },
    labels,
  );
  map.addLayer(
    {
      id: LAYERS.routeSelected,
      type: "line",
      source: SOURCES.routes,
      filter: isSelected,
      layout: lineLayout,
      paint: { "line-color": NAVY, "line-width": 4.5 },
    },
    labels,
  );
  map.addLayer({
    id: LAYERS.checkpoints,
    type: "circle",
    source: SOURCES.checkpoints,
    paint: {
      "circle-color": riskColor,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        ["case", isSelected, 8, 4.5],
        10,
        ["case", isSelected, 12, 8],
      ],
      "circle-stroke-color": ["case", isSelected, NAVY, WHITE],
      "circle-stroke-width": ["case", isSelected, 3, 1.5],
    },
  });
  map.addLayer({
    id: LAYERS.checkpointHit,
    type: "circle",
    source: SOURCES.checkpoints,
    paint: { "circle-radius": 16, "circle-opacity": 0 },
  });
  // Start: a white dot ringed in navy. End: a solid navy dot ringed in white.
  const isOrigin: ExpressionSpecification = ["==", ["get", "kind"], "origin"];
  map.addLayer({
    id: LAYERS.endpoints,
    type: "circle",
    source: SOURCES.endpoints,
    paint: {
      "circle-color": ["case", isOrigin, WHITE, NAVY],
      "circle-radius": 8,
      "circle-stroke-color": ["case", isOrigin, NAVY, WHITE],
      "circle-stroke-width": ["case", isOrigin, 3.5, 2.5],
    },
  });
}
