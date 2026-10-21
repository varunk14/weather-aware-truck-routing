import "maplibre-gl/dist/maplibre-gl.css";

import {
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  type MapMouseEvent,
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
import { BASEMAP_STYLE_URL, INITIAL_BOUNDS, isWebGLAvailable } from "./mapConfig";
import { boundsOf, checkpointsData, endpointsData, planBounds, routesData } from "./mapData";
import { addPlanLayers, LAYERS, SOURCES } from "./mapLayers";
import styles from "./MapView.module.css";

// MapLibre looks for its worker next to its own module file, which no longer holds once the
// library is bundled. Point it at the worker emitted by the build instead.
setWorkerUrl(workerUrl);

export type MapPadding = PaddingOptions;

const DEFAULT_PADDING: MapPadding = { top: 48, right: 48, bottom: 48, left: 48 };
const CAMERA_MS = 600;
const CHECKPOINT_ZOOM = 7;

interface MapViewProps {
  plan?: TripPlan | null;
  selectedRouteId?: string | null;
  selectedCheckpoint?: number | null;
  /** Space covered by other interface (the bottom sheet on phones), kept clear when framing. */
  padding?: MapPadding;
  onSelectRoute?: (routeId: string) => void;
  onSelectCheckpoint?: (index: number) => void;
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [webGLAvailable] = useState(isWebGLAvailable);
  const [loaded, setLoaded] = useState(false);
  const route = plan ? routeById(plan, selectedRouteId) : undefined;

  // The map's event handlers are bound once; they read the latest props through this ref.
  const latest = useRef({ route, padding, onSelectRoute, onSelectCheckpoint });
  useEffect(() => {
    latest.current = { route, padding, onSelectRoute, onSelectCheckpoint };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !webGLAvailable) return;

    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE_URL,
      bounds: INITIAL_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      attributionControl: { compact: true },
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

    // A short summary under the pointer on devices that can hover; taps open the full details.
    const tooltip = new Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    const canHover = window.matchMedia("(hover: hover)").matches;
    map.on("mousemove", LAYERS.checkpointHit, (event) => {
      map.getCanvas().style.cursor = "pointer";
      const index = featureProperty(map, event, LAYERS.checkpointHit, "index");
      const summary =
        canHover && typeof index === "number" && latest.current.route
          ? checkpointSummary(latest.current.route, index)
          : null;
      if (summary) tooltip.setLngLat(event.lngLat).setText(summary).addTo(map);
    });
    map.on("mouseleave", LAYERS.checkpointHit, () => {
      map.getCanvas().style.cursor = "";
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

  // Draw the plan: every route, and the checkpoints of the selected one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    setSourceData(map, SOURCES.routes, routesData(plan, selectedRouteId));
    setSourceData(map, SOURCES.checkpoints, checkpointsData(route, selectedCheckpoint));
    setSourceData(map, SOURCES.endpoints, endpointsData(plan));
  }, [loaded, plan, route, selectedRouteId, selectedCheckpoint]);

  // Frame all routes when a plan arrives, and the selected route when the user picks another.
  const framed = useRef<{ plan: TripPlan | null; routeId: string | null }>({
    plan: null,
    routeId: null,
  });
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !plan) return;
    const last = framed.current;
    framed.current = { plan, routeId: selectedRouteId };
    let bounds: LngLatBoundsLike | null = null;
    if (last.plan !== plan) bounds = planBounds(plan);
    else if (last.routeId !== selectedRouteId && route)
      bounds = boundsOf(route.geometry.coordinates);
    if (bounds) {
      map.fitBounds(bounds, {
        padding: latest.current.padding,
        duration: cameraDuration(),
        maxZoom: 11,
      });
    }
  }, [loaded, plan, route, selectedRouteId]);

  // Bring a checkpoint picked from the list into view.
  useEffect(() => {
    const map = mapRef.current;
    const checkpoint =
      selectedCheckpoint === null ? undefined : route?.checkpoints[selectedCheckpoint];
    if (!map || !loaded || !checkpoint) return;
    map.easeTo({
      center: [checkpoint.lon, checkpoint.lat],
      zoom: Math.max(map.getZoom(), CHECKPOINT_ZOOM),
      padding: latest.current.padding,
      duration: cameraDuration(),
    });
  }, [loaded, route, selectedCheckpoint]);

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
