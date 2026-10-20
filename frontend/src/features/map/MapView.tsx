import "maplibre-gl/dist/maplibre-gl.css";

import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";

import { BASEMAP_STYLE_URL, INITIAL_VIEW, isWebGLAvailable } from "./mapConfig";
import styles from "./MapView.module.css";

// MapLibre looks for its worker next to its own module file, which no longer holds once the
// library is bundled. Point it at the worker emitted by the build instead.
setWorkerUrl(workerUrl);

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webGLAvailable] = useState(isWebGLAvailable);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !webGLAvailable) return;

    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE_URL,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
    map.once("load", () => {
      setLoaded(true);
    });

    return () => {
      map.remove();
    };
  }, [webGLAvailable]);

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
