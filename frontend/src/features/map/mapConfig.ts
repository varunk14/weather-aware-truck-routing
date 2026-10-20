import type { LngLatBoundsLike } from "maplibre-gl";

/** OpenFreeMap vector basemap: free, keyless, OpenStreetMap data. */
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Continental United States, fitted to whatever screen size the map has. */
export const INITIAL_BOUNDS: LngLatBoundsLike = [
  [-124.8, 24.4],
  [-66.9, 49.4],
];

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
