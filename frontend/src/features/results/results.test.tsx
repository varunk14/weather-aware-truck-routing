import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { checkpoint, tripPlan } from "../../test/fixtures";
import { CheckpointDetails } from "./CheckpointDetails";
import { ErrorState, LoadingState, SLOW_AFTER_S } from "./PlanStatus";
import { TripResults } from "./TripResults";
import { TripSummary } from "./TripSummary";

afterEach(() => {
  vi.useRealTimers();
});

function renderResults(overrides: Partial<Parameters<typeof TripResults>[0]> = {}) {
  const props = {
    plan: tripPlan(),
    selectedRouteId: "B",
    selectedCheckpoint: null,
    onSelectRoute: vi.fn(),
    onSelectCheckpoint: vi.fn(),
    ...overrides,
  };
  render(<TripResults {...props} />);
  return props;
}

function firstRoute() {
  const route = tripPlan().routes[0];
  if (!route) throw new Error("The fixture has no routes.");
  return route;
}

describe("TripResults", () => {
  it("leads with the recommended route and the reason", () => {
    renderResults();

    const recommendation = screen.getByRole("region", { name: "Route B · 15 h 10 min" });
    expect(within(recommendation).getByText("Recommended")).toBeInTheDocument();
    expect(recommendation).toHaveTextContent("Avoids 50 mi of High-risk weather");
  });

  it("lists the routes in ranking order with their risk in numbers", () => {
    renderResults();

    const cards = screen.getAllByRole("button", { name: /^Route [ABC]/ });
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Route B, recommended",
      "Route C, 2nd choice, detour",
      "Route A, 3rd choice",
    ]);
    const routeA = screen.getByRole("button", { name: /^Route A/ });
    expect(routeA).toHaveAccessibleDescription(
      "12 h 03 min, 847 mi, arrives Thu, Oct 22, 21:03 (UTC\u22126). Low 797 mi, High 50 mi. " +
        "Average risk 0.12, 3 checkpoints.",
    );
    expect(within(routeA).getByRole("img")).toHaveAccessibleName(
      "Miles by risk level: Low 797 mi, High 50 mi",
    );
    expect(routeA).toHaveTextContent("3rd");
    expect(screen.getByRole("button", { name: /^Route C/ })).toHaveTextContent("Detour");
  });

  it("marks the selected route and reports clicks on the others", async () => {
    const user = userEvent.setup();
    const props = renderResults();

    expect(screen.getByRole("button", { name: /^Route B/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: /^Route A/ }));

    expect(props.onSelectRoute).toHaveBeenCalledWith("A");
  });

  it("lists the risky checkpoints of the selected route", async () => {
    const user = userEvent.setup();
    const props = renderResults({ selectedRouteId: "A" });

    const list = screen.getByRole("region", { name: "Weather risk on Route A" });
    const hazard = within(list).getByRole("button");
    expect(hazard).toHaveTextContent("HighMile 50rainThu, Oct 22, 09:00");

    await user.click(hazard);
    expect(props.onSelectCheckpoint).toHaveBeenCalledWith(1);
  });

  it("says when a route has no risky checkpoints", () => {
    renderResults({ selectedRouteId: "C" });

    expect(screen.getByText("All 3 checkpoints on Route C are Low risk.")).toBeInTheDocument();
  });

  it("warns instead of recommending when every route crosses No Travel conditions", () => {
    const plan = tripPlan({
      recommendation: {
        route_id: "B",
        reason: "Every route crosses No Travel conditions. Route B has the fewest (12 mi).",
        safe: false,
      },
      notes: ["Only 2 distinct truck routes were found between these places."],
    });
    renderResults({ plan });

    const recommendation = screen.getByRole("region", { name: /^Route B/ });
    expect(within(recommendation).getByText("No safe route")).toBeInTheDocument();
    expect(recommendation).toHaveTextContent("Only 2 distinct truck routes");
  });

  it("shows the legend with every level named", () => {
    renderResults();

    expect(
      within(screen.getByRole("list", { name: "Risk levels" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Low", "Moderate", "High", "Severe", "No Travel"]);
    expect(
      within(screen.getByRole("list", { name: "Map markers" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Start", "End"]);
  });
});

describe("CheckpointDetails", () => {
  it("shows the forecast and the level of each condition at the arrival time", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CheckpointDetails route={firstRoute()} index={1} loadLb={42_000} onClose={onClose} />);

    const details = screen.getByRole("region", { name: "Route A · mile 50" });
    expect(details).toHaveTextContent("Truck arrives Thu, Oct 22, 09:00 (UTC−7)");
    expect(
      within(details)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual(["Wind9 mph gusts 20Low", "Rain0.30 in/hrHigh", "Snow0.00 in/hrLow"]);
    expect(details).toHaveTextContent("Stands for about 50 mi of road");

    await user.click(within(details).getByRole("button", { name: "Close checkpoint details" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("explains when the load raised the level", () => {
    const windy = checkpoint(0, 0, {
      weather: { wind_mph: 40, gust_mph: 52, rain_in_hr: 0, snow_in_hr: 0 },
      risk: {
        level: "severe",
        score: 3,
        wind: "high",
        rain: "low",
        snow: "low",
        causes: ["wind", "load"],
      },
    });
    render(
      <CheckpointDetails
        route={{ ...firstRoute(), checkpoints: [windy] }}
        index={0}
        loadLb={42_000}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/A 42,000 lb load makes this wind more dangerous/)).toBeInTheDocument();
  });

  it("renders nothing for a checkpoint that does not exist", () => {
    const { container } = render(
      <CheckpointDetails route={firstRoute()} index={9} loadLb={1} onClose={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("LoadingState", () => {
  it("counts the seconds and admits a slow service after a while", () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    render(<LoadingState startedAt={Date.now()} onCancel={onCancel} />);

    expect(screen.getByRole("status")).toHaveTextContent("usually takes about 5 seconds");
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_S * 1000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("slow right now");
    expect(screen.getByText(`${String(SLOW_AFTER_S)} s`)).toBeInTheDocument();

    screen.getByRole("button", { name: "Cancel" }).click();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ErrorState", () => {
  it("shows the message and offers a retry for passing problems", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        error={new ApiError("The weather service is not responding.", 503)}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The weather service is not responding.");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it("does not offer a retry when no route can exist", () => {
    render(
      <ErrorState
        error={new ApiError("No truck route connects these places.", 422)}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("TripSummary", () => {
  it("sums up the trip and offers to edit it", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<TripSummary plan={tripPlan()} onEdit={onEdit} />);

    expect(screen.getByText(/Seattle, WA/)).toHaveTextContent(
      "Seattle, WA → to Salt Lake City, UT",
    );
    expect(screen.getByText(/42,000 lb/)).toHaveTextContent(
      "Thu, Oct 22, 08:00 (UTC−7) · 42,000 lb · every 25 mi",
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalled();
  });
});
