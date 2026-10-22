import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHONE_QUERY } from "../hooks/useMediaQuery";
import { ApiError, planTrip, suggestPlaces } from "../lib/api";
import { tripPlan } from "../test/fixtures";
import { mediaQueryList } from "../test/media";
import { App } from "./App";

interface MapProps {
  plan?: { routes: unknown[] } | null;
  selectedRouteId?: string | null;
  selectedCheckpoint?: number | null;
  onSelectCheckpoint?: (index: number) => void;
}

vi.mock("../features/map/MapView", () => ({
  default: (props: MapProps) => (
    <div
      role="region"
      aria-label="Route map"
      data-routes={props.plan?.routes.length ?? 0}
      data-selected-route={props.selectedRouteId ?? ""}
      data-selected-checkpoint={props.selectedCheckpoint ?? ""}
    >
      <button type="button" onClick={() => props.onSelectCheckpoint?.(1)}>
        Tap checkpoint 1 on the map
      </button>
    </div>
  ),
}));

vi.mock("../hooks/useApiStatus", () => ({
  useApiStatus: () => "online",
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  planTrip: vi.fn(),
  suggestPlaces: vi.fn(),
}));

const defaultMatchMedia = window.matchMedia.bind(window);

function usePhoneLayout() {
  window.matchMedia = (query: string) => mediaQueryList(query, () => query === PHONE_QUERY);
}

beforeEach(() => {
  vi.mocked(suggestPlaces).mockResolvedValue([]);
});

afterEach(() => {
  window.matchMedia = defaultMatchMedia;
  vi.mocked(planTrip).mockReset();
  vi.mocked(suggestPlaces).mockReset();
});

async function planATrip(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("combobox", { name: "Origin" }), "Seattle, WA");
  await user.type(screen.getByRole("combobox", { name: "Destination" }), "Salt Lake City, UT");
  await user.type(screen.getByRole("textbox", { name: "Load weight (lb)" }), "42000");
  await user.click(screen.getByRole("button", { name: "Plan routes" }));
}

describe("App on a wide screen", () => {
  it("shows the brand, the trip form, how routes are ranked and the map", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Clearway" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("API online");
    expect(screen.getByRole("form", { name: "Plan a trip" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Fewest miles in No Travel conditions",
      "Fewest miles in Severe weather",
      "Fewest miles in High-risk weather",
      "Lowest average risk",
      "Shortest travel time",
    ]);
    expect(screen.getByRole("link", { name: "Weather data by Open-Meteo.com" })).toHaveAttribute(
      "href",
      "https://open-meteo.com",
    );
    expect(await screen.findByRole("region", { name: "Route map" })).toBeInTheDocument();
  });

  it("plans a trip and shows the recommendation, the routes and the map", async () => {
    let resolve: (plan: ReturnType<typeof tripPlan>) => void = () => undefined;
    vi.mocked(planTrip).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await planATrip(user);
    expect(
      screen.getByRole("heading", { name: "Planning three truck routes" }),
    ).toBeInTheDocument();

    resolve(tripPlan());
    expect(
      await screen.findByRole("region", { name: "Route B · 15 h 10 min" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Route [ABC],/ })).toHaveLength(3);
    expect(
      screen.queryByRole("heading", { name: "How routes are ranked" }),
    ).not.toBeInTheDocument();
    const map = screen.getByRole("region", { name: "Route map" });
    expect(map).toHaveAttribute("data-routes", "3");
    expect(map).toHaveAttribute("data-selected-route", "B");
  });

  it("opens a checkpoint's details from the list or the map, and closes them", async () => {
    vi.mocked(planTrip).mockResolvedValue(tripPlan());
    const user = userEvent.setup();
    render(<App />);
    await planATrip(user);

    await user.click(await screen.findByRole("button", { name: /^Route A,/ }));
    const hazards = screen.getByRole("region", { name: "Weather risk on Route A" });
    await user.click(within(hazards).getByRole("button"));

    expect(screen.getByRole("region", { name: "Route A · mile 50" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Route map" })).toHaveAttribute(
      "data-selected-checkpoint",
      "1",
    );

    await user.click(screen.getByRole("button", { name: "Close checkpoint details" }));
    expect(screen.queryByRole("region", { name: "Route A · mile 50" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tap checkpoint 1 on the map" }));
    expect(screen.getByRole("region", { name: "Route A · mile 50" })).toBeInTheDocument();
  });

  it("announces the recommendation once the plan is ready", async () => {
    vi.mocked(planTrip).mockResolvedValue(tripPlan());
    const user = userEvent.setup();
    const { container } = render(<App />);

    await planATrip(user);

    await waitFor(() => {
      expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
        "Routes ready. Recommended: Route B, 15 h 10 min. Avoids 50 mi of High-risk weather",
      );
    });
  });

  it("hides the side panel so the map has the whole width, and shows it again", async () => {
    vi.mocked(planTrip).mockResolvedValue(tripPlan());
    const user = userEvent.setup();
    const { container } = render(<App />);
    await planATrip(user);
    await screen.findByRole("region", { name: "Route B · 15 h 10 min" });

    const toggle = screen.getByRole("button", { name: "Trip panel" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("title", "Hide the trip panel");
    expect(toggle).toHaveAttribute(
      "aria-controls",
      screen.getByRole("region", { name: "Trip planner" }).id,
    );
    await user.click(toggle);
    expect(container.querySelector("main")).toHaveAttribute("data-panel", "hidden");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("title", "Show the trip panel");
    expect(toggle).toHaveFocus();
    // The header, with the API's status, stays.
    expect(screen.getByRole("status")).toHaveTextContent("API online");

    // The plan, the selection and the timeline stay as they were.
    expect(screen.getByRole("region", { name: "Forecast timeline" })).toBeInTheDocument();
    await user.click(toggle);
    expect(container.querySelector("main")).not.toHaveAttribute("data-panel");
    expect(screen.getByRole("region", { name: "Route B · 15 h 10 min" })).toBeInTheDocument();
  });

  it("explains a failed plan and can try again", async () => {
    vi.mocked(planTrip).mockRejectedValueOnce(
      new ApiError("The weather service is not responding. Try again in a moment.", 503),
    );
    vi.mocked(planTrip).mockResolvedValueOnce(tripPlan());
    const user = userEvent.setup();
    render(<App />);
    await planATrip(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("weather service is not responding");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("region", { name: "Route B · 15 h 10 min" }),
    ).toBeInTheDocument();
    expect(planTrip).toHaveBeenCalledTimes(2);
  });
});

describe("App on a phone", () => {
  it("opens with the trip form in a full-height sheet over the map", () => {
    usePhoneLayout();
    render(<App />);

    const sheet = screen.getByRole("region", { name: "Trip" });
    expect(sheet).toHaveAttribute("data-snap", "full");
    expect(within(sheet).getByRole("heading", { name: "Plan a trip" })).toBeInTheDocument();
    expect(within(sheet).getByRole("form", { name: "Plan a trip" })).toBeInTheDocument();
  });

  it("lowers the sheet to the trip's bar once the plan is ready, leaving the map in view", async () => {
    vi.mocked(planTrip).mockResolvedValue(tripPlan());
    usePhoneLayout();
    const user = userEvent.setup();
    render(<App />);

    await planATrip(user);

    const sheet = screen.getByRole("region", { name: "Trip" });
    await waitFor(() => {
      expect(
        within(sheet).getByRole("region", { name: "Route B · 15 h 10 min" }),
      ).toBeInTheDocument();
    });
    expect(sheet).toHaveAttribute("data-snap", "bar");
    expect(within(sheet).getByText(/Seattle, WA/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Forecast timeline" })).toBeInTheDocument();
    // The recommendation is one tap on the handle away.
    const recommendation = within(sheet).getByRole("region", { name: "Route B · 15 h 10 min" });
    expect(recommendation.closest("[inert]")).not.toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Show more of the trip panel" }));
    expect(sheet).toHaveAttribute("data-snap", "peek");
    expect(recommendation.closest("[inert]")).toBeNull();
    expect(screen.getByRole("region", { name: "Forecast timeline" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Edit" }));
    expect(sheet).toHaveAttribute("data-snap", "full");
    await user.click(within(sheet).getByRole("button", { name: "Back to routes" }));
    expect(sheet).toHaveAttribute("data-snap", "bar");
  });

  it("opens a new plan lowered to the bar again after the trip was edited", async () => {
    vi.mocked(planTrip).mockResolvedValue(tripPlan());
    usePhoneLayout();
    const user = userEvent.setup();
    render(<App />);
    await planATrip(user);
    const sheet = screen.getByRole("region", { name: "Trip" });
    await screen.findByRole("region", { name: "Route B · 15 h 10 min" });

    await user.click(within(sheet).getByRole("button", { name: "Show more of the trip panel" }));
    await user.click(within(sheet).getByRole("button", { name: "Show more of the trip panel" }));
    expect(sheet).toHaveAttribute("data-snap", "half");
    await user.click(within(sheet).getByRole("button", { name: "Edit" }));
    await user.click(within(sheet).getByRole("button", { name: "Plan routes" }));

    await screen.findByRole("region", { name: "Route B · 15 h 10 min" });
    expect(sheet).toHaveAttribute("data-snap", "bar");
  });

  it("lowers the sheet to the bar when a route is picked, so the map shows it", async () => {
    vi.mocked(planTrip).mockResolvedValue(tripPlan());
    usePhoneLayout();
    const user = userEvent.setup();
    render(<App />);
    await planATrip(user);
    const sheet = screen.getByRole("region", { name: "Trip" });
    await screen.findByRole("region", { name: "Route B · 15 h 10 min" });

    await user.click(within(sheet).getByRole("button", { name: "Show more of the trip panel" }));
    await user.click(within(sheet).getByRole("button", { name: "Show more of the trip panel" }));
    expect(sheet).toHaveAttribute("data-snap", "half");
    await user.click(within(sheet).getByRole("button", { name: /^Route C,/ }));

    expect(sheet).toHaveAttribute("data-snap", "bar");
    expect(screen.getByRole("region", { name: "Route map" })).toHaveAttribute(
      "data-selected-route",
      "C",
    );
  });
});
