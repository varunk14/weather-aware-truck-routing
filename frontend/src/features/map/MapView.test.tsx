import { act, render, screen } from "@testing-library/react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TripPlan } from "../../lib/types";
import { tripPlan } from "../../test/fixtures";
import { BASEMAP_STYLE_URL } from "./mapConfig";
import { boundsOf, checkpointsData, planBounds, routesData } from "./mapData";
import { LAYERS, SOURCES } from "./mapLayers";
import MapView, { CAMERA_SETTLE_MS } from "./MapView";

type Handler = (event: unknown) => void;

const mapInstance = vi.hoisted(() => {
  const once = new Map<string, () => void>();
  const listeners: { event: string; layer?: string; handler: (event: unknown) => void }[] = [];
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  return {
    once,
    listeners,
    sources,
    renderedFeatures: new Map<string, unknown[]>(),
    addControl: vi.fn(),
    addLayer: vi.fn(),
    addSource: vi.fn((id: string) => {
      sources.set(id, { setData: vi.fn() });
    }),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    getSource: vi.fn((id: string) => sources.get(id)),
    getStyle: vi.fn(() => ({ layers: [{ id: "place-labels", type: "symbol" }] })),
    getZoom: vi.fn(() => 4),
    remove: vi.fn(),
  };
});

vi.mock("maplibre-gl", () => {
  class MockPopup {
    setLngLat() {
      return this;
    }
    setText() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
  }
  return {
    Map: vi.fn(function MockMap() {
      return {
        ...mapInstance,
        once: (event: string, handler: () => void) => mapInstance.once.set(event, handler),
        on: (event: string, layerOrHandler: string | Handler, handler?: Handler) => {
          if (typeof layerOrHandler === "string" && handler) {
            mapInstance.listeners.push({ event, layer: layerOrHandler, handler });
          } else if (typeof layerOrHandler === "function") {
            mapInstance.listeners.push({ event, handler: layerOrHandler });
          }
        },
        queryRenderedFeatures: (_point: unknown, options: { layers: string[] }) =>
          mapInstance.renderedFeatures.get(options.layers[0] ?? "") ?? [],
      };
    }),
    NavigationControl: vi.fn(function MockNavigationControl() {
      return {};
    }),
    Popup: MockPopup,
    setWorkerUrl: vi.fn(),
  };
});

// setWorkerUrl runs once when MapView is imported; record it before per-test mock clearing.
const workerUrlCalls = [...vi.mocked(setWorkerUrl).mock.calls];

function stubWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    available ? ({} as RenderingContext) : null,
  );
}

function loadMap() {
  act(() => {
    mapInstance.once.get("load")?.();
  });
}

/** Camera moves wait briefly for the layout (the phone's bottom sheet) to settle. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(CAMERA_SETTLE_MS);
  });
}

function click(features: Record<string, unknown[]>) {
  mapInstance.renderedFeatures.clear();
  for (const [layer, found] of Object.entries(features)) {
    mapInstance.renderedFeatures.set(layer, found);
  }
  for (const listener of mapInstance.listeners) {
    if (listener.event === "click" && !listener.layer) listener.handler({ point: { x: 1, y: 1 } });
  }
}

function lastData(source: string): unknown {
  return mapInstance.sources.get(source)?.setData.mock.lastCall?.[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mapInstance.once.clear();
  mapInstance.listeners.length = 0;
  mapInstance.sources.clear();
  mapInstance.renderedFeatures.clear();
  stubWebGL(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MapView", () => {
  it("points MapLibre at the bundled worker script", () => {
    expect(workerUrlCalls).toEqual([[expect.stringContaining("maplibre-gl-worker")]]);
  });

  it("creates a map with the basemap style and removes it on unmount", () => {
    const { unmount } = render(<MapView />);

    expect(MapLibreMap).toHaveBeenCalledWith(expect.objectContaining({ style: BASEMAP_STYLE_URL }));
    expect(mapInstance.addControl).toHaveBeenCalledTimes(1);

    unmount();
    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });

  it("stays busy until the map has loaded, then adds the trip layers", () => {
    render(<MapView />);
    const region = screen.getByRole("region", { name: "Route map" });
    expect(region).toHaveAttribute("aria-busy", "true");

    loadMap();

    expect(region).toHaveAttribute("aria-busy", "false");
    expect(mapInstance.addSource).toHaveBeenCalledTimes(3);
    // Route lines go under the basemap labels; checkpoints and endpoints on top.
    expect(mapInstance.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: LAYERS.routeSelected }),
      "place-labels",
    );
    expect(mapInstance.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: LAYERS.checkpoints }),
    );
  });

  it("draws the routes and the selected route's checkpoints, and frames all routes", () => {
    const plan = tripPlan();
    render(<MapView plan={plan} selectedRouteId="A" selectedCheckpoint={null} />);
    loadMap();

    expect(lastData(SOURCES.routes)).toEqual(routesData(plan, "A"));
    expect(lastData(SOURCES.checkpoints)).toEqual(checkpointsData(plan.routes[0], null));
    settle();
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(
      planBounds(plan),
      expect.objectContaining({ maxZoom: 11 }),
    );
  });

  it("only sends the map the data that changed", () => {
    const plan = tripPlan();
    const { rerender } = render(<MapView plan={plan} selectedRouteId="A" />);
    loadMap();
    const routes = mapInstance.sources.get(SOURCES.routes)?.setData;
    const endpoints = mapInstance.sources.get(SOURCES.endpoints)?.setData;
    routes?.mockClear();
    endpoints?.mockClear();

    rerender(<MapView plan={plan} selectedRouteId="A" selectedCheckpoint={1} />);

    expect(routes).not.toHaveBeenCalled();
    expect(endpoints).not.toHaveBeenCalled();
    expect(lastData(SOURCES.checkpoints)).toEqual(checkpointsData(plan.routes[0], 1));
  });

  it("frames the route the user selects, and eases to a selected checkpoint", () => {
    const plan = tripPlan();
    const { rerender } = render(<MapView plan={plan} selectedRouteId="B" />);
    loadMap();
    settle();
    mapInstance.fitBounds.mockClear();

    rerender(<MapView plan={plan} selectedRouteId="C" />);
    settle();
    const routeC = plan.routes[2]?.geometry.coordinates ?? [];
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(boundsOf(routeC), expect.anything());

    mapInstance.fitBounds.mockClear();
    rerender(<MapView plan={plan} selectedRouteId="C" selectedCheckpoint={1} />);
    settle();
    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
    expect(mapInstance.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-121.5, 46.5], zoom: 7 }),
    );
  });

  it("frames with the padding the layout settles on, not the one it had a moment before", () => {
    const plan = tripPlan();
    const high = { top: 32, right: 32, bottom: 600, left: 32 };
    const low = { top: 32, right: 32, bottom: 230, left: 32 };
    const { rerender } = render(<MapView plan={plan} selectedRouteId="B" padding={high} />);
    loadMap();
    settle();
    mapInstance.fitBounds.mockClear();

    // Picking a route lowers the sheet: the selection arrives first, the new height just after.
    rerender(<MapView plan={plan} selectedRouteId="C" padding={high} />);
    rerender(<MapView plan={plan} selectedRouteId="C" padding={low} />);
    settle();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ padding: low }),
    );
  });

  it("does not move the camera when only the padding changes", () => {
    const plan = tripPlan();
    const { rerender } = render(<MapView plan={plan} selectedRouteId="B" />);
    loadMap();
    settle();
    mapInstance.fitBounds.mockClear();

    rerender(
      <MapView
        plan={plan}
        selectedRouteId="B"
        padding={{ top: 0, right: 0, bottom: 300, left: 0 }}
      />,
    );
    settle();

    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
  });

  it("frames a new plan even when it has the same route ids", () => {
    const { rerender } = render(<MapView plan={tripPlan()} selectedRouteId="B" />);
    loadMap();
    settle();
    mapInstance.fitBounds.mockClear();

    const next: TripPlan = tripPlan({ load_lb: 1 });
    rerender(<MapView plan={next} selectedRouteId="B" />);
    settle();

    expect(mapInstance.fitBounds).toHaveBeenCalledWith(planBounds(next), expect.anything());
  });

  it("credits the routing and weather data on the map", () => {
    render(<MapView />);

    const [options] = vi.mocked(MapLibreMap).mock.calls[0] ?? [];
    expect(options?.attributionControl).toMatchObject({
      customAttribution: expect.stringMatching(/TomTom.*Open-Meteo/) as unknown,
    });
  });

  it("reports taps on checkpoints first, then on other routes", () => {
    const onSelectRoute = vi.fn();
    const onSelectCheckpoint = vi.fn();
    render(
      <MapView
        plan={tripPlan()}
        selectedRouteId="B"
        onSelectRoute={onSelectRoute}
        onSelectCheckpoint={onSelectCheckpoint}
      />,
    );
    loadMap();

    click({
      [LAYERS.checkpointHit]: [{ properties: { index: 2 } }],
      [LAYERS.routeAlternativeHit]: [{ properties: { id: "A" } }],
    });
    expect(onSelectCheckpoint).toHaveBeenCalledWith(2);
    expect(onSelectRoute).not.toHaveBeenCalled();

    click({ [LAYERS.routeAlternativeHit]: [{ properties: { id: "A" } }] });
    expect(onSelectRoute).toHaveBeenCalledWith("A");

    click({});
    expect(onSelectRoute).toHaveBeenCalledTimes(1);
  });

  it("explains the problem instead of crashing when WebGL is unavailable", () => {
    stubWebGL(false);

    render(<MapView />);

    expect(screen.getByRole("region", { name: "Route map" })).toHaveTextContent(/needs WebGL/);
    expect(MapLibreMap).not.toHaveBeenCalled();
  });
});
