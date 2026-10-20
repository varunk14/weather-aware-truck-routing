/** OpenFreeMap vector basemap: free, keyless, OpenStreetMap data. */
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Continental United States. */
export const INITIAL_VIEW = {
  center: [-98.5, 39.5] as [number, number],
  zoom: 3.6,
};

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
