import { act, render, screen } from "@testing-library/react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BASEMAP_STYLE_URL } from "./mapConfig";
import MapView from "./MapView";

const mapInstance = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    addControl: vi.fn(),
    remove: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
    }),
  };
});

vi.mock("maplibre-gl", () => ({
  Map: vi.fn(function MockMap() {
    return mapInstance;
  }),
  NavigationControl: vi.fn(function MockNavigationControl() {
    return {};
  }),
  setWorkerUrl: vi.fn(),
}));

// setWorkerUrl runs once when MapView is imported; record it before per-test mock clearing.
const workerUrlCalls = [...vi.mocked(setWorkerUrl).mock.calls];

function stubWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    available ? ({} as RenderingContext) : null,
  );
}

beforeEach(() => {
  mapInstance.addControl.mockClear();
  mapInstance.remove.mockClear();
  mapInstance.once.mockClear();
  mapInstance.handlers.clear();
  vi.mocked(MapLibreMap).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MapView", () => {
  it("points MapLibre at the bundled worker script", () => {
    expect(workerUrlCalls).toEqual([[expect.stringContaining("maplibre-gl-worker")]]);
  });

  it("creates a map with the basemap style and removes it on unmount", () => {
    stubWebGL(true);

    const { unmount } = render(<MapView />);

    expect(MapLibreMap).toHaveBeenCalledWith(expect.objectContaining({ style: BASEMAP_STYLE_URL }));
    expect(mapInstance.addControl).toHaveBeenCalledTimes(1);

    unmount();
    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });

  it("stays busy until the map has loaded", () => {
    stubWebGL(true);

    render(<MapView />);
    const region = screen.getByRole("region", { name: "Route map" });
    expect(region).toHaveAttribute("aria-busy", "true");

    act(() => {
      mapInstance.handlers.get("load")?.();
    });
    expect(region).toHaveAttribute("aria-busy", "false");
  });

  it("explains the problem instead of crashing when WebGL is unavailable", () => {
    stubWebGL(false);

    render(<MapView />);

    expect(screen.getByRole("region", { name: "Route map" })).toHaveTextContent(/needs WebGL/);
    expect(MapLibreMap).not.toHaveBeenCalled();
  });
});
