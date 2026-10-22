import "maplibre-gl/dist/maplibre-gl.css";

import {
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  type MapMouseEvent,
  Marker,
  NavigationControl,
  type PaddingOptions,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";

import { formatClock, formatOffset } from "../../lib/format";
import { routeById } from "../../lib/plan";
import { describeCauses, RISK_LABELS } from "../../lib/risk";
import type { PlannedRoute, TripPlan } from "../../lib/types";
import {
  colorExpression,
  framePosition,
  type HeatLayer,
  heatmapData,
  opacityExpression,
} from "../heatmap/heatmap";
import { BASEMAP_STYLE_URL, INITIAL_BOUNDS, isWebGLAvailable } from "./mapConfig";
import { boundsOf, checkpointsData, endpointsData, planBounds, routesData } from "./mapData";
import { addPlanLayers, LAYERS, SOURCES } from "./mapLayers";
import styles from "./MapView.module.css";

// MapLibre looks for its worker next to its own module file, which no longer holds once the
// library is bundled. Point it at the worker emitted by the build instead.
setWorkerUrl(workerUrl);

export type MapPadding = PaddingOptions;

type CameraMove = { bounds: LngLatBoundsLike } | { center: [number, number] };

const DEFAULT_PADDING: MapPadding = { top: 48, right: 48, bottom: 48, left: 48 };
const CAMERA_MS = 600;
const CHECKPOINT_ZOOM = 7;
/**
 * Camera moves wait this long for the layout to settle: picking a route on a phone also lowers
 * the bottom sheet, and the map must frame the route with the sheet's new height, not the old.
 */
export const CAMERA_SETTLE_MS = 60;
const DATA_ATTRIBUTION = "Routing © TomTom · Weather: Open-Meteo";

interface MapViewProps {
  plan?: TripPlan | null;
  selectedRouteId?: string | null;
  selectedCheckpoint?: number | null;
  /** Space covered by other interface (the bottom sheet on phones), kept clear when framing. */
  padding?: MapPadding;
  onSelectRoute?: (routeId: string) => void;
  onSelectCheckpoint?: (index: number) => void;
  /** Which weather the corridor heatmap shows, or null to hide it (no timeline to explain it). */
  heatLayer?: HeatLayer | null;
  /** Hours after departure shown by the heatmap (the slider). */
  hour?: number;
  /** Where the truck is at that hour and which way it points, or null to hide it. */
  truck?: { lngLat: [number, number]; facing: "left" | "right" } | null;
}

/** A navy tile with a white truck, unlike the round start and end markers. */
function truckElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = styles.truck ?? "";
  element.setAttribute("aria-hidden", "true");
  element.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M3 7h10v8H3zM13 10h4l3 3v2h-7z"/>' +
    '<circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/></svg>';
  return element;
}

function cameraDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CAMERA_MS;
}

function setSourceData(map: MapLibreMap, id: string, data: unknown): void {
  // The returned promise only reports when the worker has the data; nothing waits for it.
  void map.getSource<GeoJSONSource>(id)?.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
}

function featureProperty(map: MapLibreMap, event: MapMouseEvent, layer: string, key: string) {
  const [feature] = map.queryRenderedFeatures(event.point, { layers: [layer] });
  return feature?.properties[key] as unknown;
}

/** "Mile 450 · High (rain) · 14:43 UTC−7", for the hover tooltip. */
function checkpointSummary(route: PlannedRoute, index: number): string | null {
  const checkpoint = route.checkpoints[index];
  if (!checkpoint) return null;
  const { risk } = checkpoint;
  const causes = risk.causes.length ? ` (${describeCauses(risk.causes)})` : "";
  return (
    `Mile ${Math.round(checkpoint.mile).toLocaleString("en-US")} · ` +
    `${RISK_LABELS[risk.level]}${causes} · ${formatClock(checkpoint.eta)} ${formatOffset(checkpoint.eta)}`
  );
}

export default function MapView({
  plan = null,
  selectedRouteId = null,
  selectedCheckpoint = null,
  padding = DEFAULT_PADDING,
  onSelectRoute,
  onSelectCheckpoint,
  heatLayer = "risk",
  hour = 0,
  truck = null,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [webGLAvailable] = useState(isWebGLAvailable);
  const [loaded, setLoaded] = useState(false);
  const route = plan ? routeById(plan, selectedRouteId) : undefined;

  // The map's event handlers are bound once; they read the latest props through this ref.
  const latest = useRef({ plan, route, onSelectRoute, onSelectCheckpoint });
  useEffect(() => {
    latest.current = { plan, route, onSelectRoute, onSelectCheckpoint };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !webGLAvailable) return;

    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE_URL,
      bounds: INITIAL_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      // The data sources are credited on the map itself, so the credit is always on screen.
      attributionControl: { compact: true, customAttribution: DATA_ATTRIBUTION },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
    map.once("load", () => {
      addPlanLayers(map);
      setLoaded(true);
    });

    map.on("click", (event) => {
      const index = featureProperty(map, event, LAYERS.checkpointHit, "index");
      if (typeof index === "number") {
        latest.current.onSelectCheckpoint?.(index);
        return;
      }
      const id = featureProperty(map, event, LAYERS.routeAlternativeHit, "id");
      if (typeof id === "string") latest.current.onSelectRoute?.(id);
    });

    // A short label under the pointer; taps and clicks open the full details. Whether the
    // device can hover is checked each time, since a window can switch between mouse and touch.
    const tooltip = new Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    const canHover = () => window.matchMedia("(hover: hover)").matches;
    map.on("mousemove", LAYERS.checkpointHit, (event) => {
      map.getCanvas().style.cursor = "pointer";
      const index = featureProperty(map, event, LAYERS.checkpointHit, "index");
      const summary =
        canHover() && typeof index === "number" && latest.current.route
          ? checkpointSummary(latest.current.route, index)
          : null;
      if (summary) tooltip.setLngLat(event.lngLat).setText(summary).addTo(map);
    });
    map.on("mouseleave", LAYERS.checkpointHit, () => {
      map.getCanvas().style.cursor = "";
      tooltip.remove();
    });
    map.on("mousemove", LAYERS.endpoints, (event) => {
      const kind = featureProperty(map, event, LAYERS.endpoints, "kind");
      const plan = latest.current.plan;
      if (!canHover() || !plan) return;
      const label =
        kind === "origin" ? `Start: ${plan.origin.title}` : `End: ${plan.destination.title}`;
      tooltip.setLngLat(event.lngLat).setText(label).addTo(map);
    });
    map.on("mouseleave", LAYERS.endpoints, () => {
      tooltip.remove();
    });
    map.on("mouseenter", LAYERS.routeAlternativeHit, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYERS.routeAlternativeHit, () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [webGLAvailable]);

  // Draw the plan. Each source is only sent to the map when its own data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) setSourceData(map, SOURCES.routes, routesData(plan, selectedRouteId));
  }, [loaded, plan, selectedRouteId]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) {
      setSourceData(map, SOURCES.checkpoints, checkpointsData(route, selectedCheckpoint));
    }
  }, [loaded, route, selectedCheckpoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) setSourceData(map, SOURCES.endpoints, endpointsData(plan));
  }, [loaded, plan]);

  // The heatmap's frames are uploaded once per plan; the slider only repaints them.
  const heatmap = plan?.heatmap ?? null;
  const departure = plan?.routes[0]?.departure ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (map && loaded) setSourceData(map, SOURCES.heatmap, heatmapData(heatmap));
  }, [loaded, heatmap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !heatmap || !departure) return;
    if (!heatLayer) {
      map.setPaintProperty(LAYERS.heatmap, "fill-opacity", 0);
      return;
    }
    const position = framePosition(heatmap, departure, hour);
    map.setPaintProperty(LAYERS.heatmap, "fill-color", colorExpression(heatLayer, position));
    map.setPaintProperty(LAYERS.heatmap, "fill-opacity", opacityExpression(heatLayer, position));
  }, [loaded, heatmap, departure, heatLayer, hour]);

  const truckMarker = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (!truck) {
      truckMarker.current?.remove();
      truckMarker.current = null;
      return;
    }
    truckMarker.current ??= new Marker({ element: truckElement() })
      .setLngLat(truck.lngLat)
      .addTo(map);
    truckMarker.current.setLngLat(truck.lngLat);
    truckMarker.current.getElement().dataset.facing = truck.facing;
  }, [loaded, truck]);

  // Move the camera: to all routes when a plan arrives, to a route when the user picks another,
  // to a checkpoint when one is picked. The move is applied once the padding has settled.
  const framed = useRef<{
    plan: TripPlan | null;
    routeId: string | null;
    checkpoint: number | null;
  }>({ plan: null, routeId: null, checkpoint: null });
  const pendingMove = useRef<CameraMove | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan) return;
    const last = framed.current;
    framed.current = { plan, routeId: selectedRouteId, checkpoint: selectedCheckpoint };
    const checkpoint =
      selectedCheckpoint === null ? undefined : route?.checkpoints[selectedCheckpoint];
    if (last.plan !== plan) {
      const bounds = planBounds(plan);
      if (bounds) pendingMove.current = { bounds };
    } else if (last.routeId !== selectedRouteId && route) {
      const bounds = boundsOf(route.geometry.coordinates);
      if (bounds) pendingMove.current = { bounds };
    } else if (last.checkpoint !== selectedCheckpoint && checkpoint) {
      pendingMove.current = { center: [checkpoint.lon, checkpoint.lat] };
    }
    if (!pendingMove.current) return;

    const timer = setTimeout(() => {
      const move = pendingMove.current;
      pendingMove.current = null;
      if (!move) return;
      const duration = cameraDuration();
      if ("bounds" in move) {
        map.fitBounds(move.bounds, { padding, duration, maxZoom: 11 });
      } else {
        map.easeTo({
          center: move.center,
          zoom: Math.max(map.getZoom(), CHECKPOINT_ZOOM),
          padding,
          duration,
        });
      }
    }, CAMERA_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [loaded, plan, route, selectedRouteId, selectedCheckpoint, padding]);

  if (!webGLAvailable) {
    return (
      <div className={styles.fallback} role="region" aria-label="Route map">
        <p>The map needs WebGL, which this browser does not provide.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={styles.map}
      role="region"
      aria-label="Route map"
      aria-busy={!loaded}
    />
  );
}
