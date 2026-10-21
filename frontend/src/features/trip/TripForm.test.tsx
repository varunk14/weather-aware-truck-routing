import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, planTrip, suggestPlaces } from "../../lib/api";
import { TripForm } from "./TripForm";
import { useTripPlanner } from "./useTripPlanner";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  planTrip: vi.fn(),
  suggestPlaces: vi.fn(),
}));

function Planner() {
  const { draft, errors, state, change, submit } = useTripPlanner();
  return (
    <TripForm
      draft={draft}
      errors={errors}
      busy={state.status === "loading"}
      onChange={change}
      onSubmit={submit}
    />
  );
}

afterEach(() => {
  vi.mocked(planTrip).mockReset();
  vi.mocked(suggestPlaces).mockReset();
});

async function fillTrip(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(suggestPlaces).mockResolvedValue([]);
  await user.type(screen.getByRole("combobox", { name: "Origin" }), "Seattle, WA");
  await user.type(screen.getByRole("combobox", { name: "Destination" }), "Salt Lake City, UT");
  await user.type(screen.getByRole("textbox", { name: "Load weight (lb)" }), "42,000");
}

describe("TripForm", () => {
  it("shows what to fix and moves to the first problem instead of sending an incomplete trip", async () => {
    const user = userEvent.setup();
    render(<Planner />);

    await user.click(screen.getByRole("button", { name: "Plan routes" }));

    expect(screen.getByText("Enter where the trip starts.")).toBeInTheDocument();
    expect(screen.getByText("Enter where the trip ends.")).toBeInTheDocument();
    expect(
      screen.getByText("Enter the load in whole pounds, from 1 to 80,000."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Origin" })).toHaveFocus();
    });
    expect(planTrip).not.toHaveBeenCalled();
  });

  it("clears a field's message as soon as it is edited", async () => {
    const user = userEvent.setup();
    render(<Planner />);

    await user.click(screen.getByRole("button", { name: "Plan routes" }));
    // The form first moves focus to the first problem; type only after that has happened.
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Origin" })).toHaveFocus();
    });
    await user.type(screen.getByRole("textbox", { name: "Load weight (lb)" }), "4");

    expect(screen.queryByText(/whole pounds/)).not.toBeInTheDocument();
    expect(screen.getByText("Enter where the trip starts.")).toBeInTheDocument();
  });

  it("sends the trip and shows that it is planning", async () => {
    vi.mocked(planTrip).mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<Planner />);

    await fillTrip(user);
    await user.click(screen.getByRole("radio", { name: "50 mi" }));
    await user.click(screen.getByRole("button", { name: "Plan routes" }));

    const button = screen.getByRole("button", { name: "Planning routes…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    // Pressing it again while planning does not send a second request.
    await user.click(button);
    expect(planTrip).toHaveBeenCalledTimes(1);
    const [trip] = vi.mocked(planTrip).mock.calls[0] ?? [];
    expect(trip).toMatchObject({
      origin: { query: "Seattle, WA" },
      destination: { query: "Salt Lake City, UT" },
      load_lb: 42_000,
      interval_mi: 50,
    });
  });

  it("swaps the origin and destination", async () => {
    const user = userEvent.setup();
    render(<Planner />);
    vi.mocked(suggestPlaces).mockResolvedValue([]);

    await user.type(screen.getByRole("combobox", { name: "Origin" }), "Seattle");
    await user.type(screen.getByRole("combobox", { name: "Destination" }), "Boise");
    await user.click(screen.getByRole("button", { name: "Swap origin and destination" }));

    expect(screen.getByRole("combobox", { name: "Origin" })).toHaveValue("Boise");
    expect(screen.getByRole("combobox", { name: "Destination" })).toHaveValue("Seattle");
  });

  it("shows the API's field messages on the matching fields", async () => {
    vi.mocked(planTrip).mockRejectedValue(
      new ApiError("Some details need fixing.", 400, {
        destination: "The origin and destination are the same place.",
      }),
    );
    const user = userEvent.setup();
    render(<Planner />);

    await fillTrip(user);
    await user.click(screen.getByRole("button", { name: "Plan routes" }));

    expect(
      await screen.findByText("The origin and destination are the same place."),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Destination" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("starts with 25 mile checkpoints and a departure at the next whole hour", () => {
    render(<Planner />);

    expect(screen.getByRole("radio", { name: "25 mi" })).toBeChecked();
    const departure = screen.getByLabelText<HTMLInputElement>("Departure");
    expect(new Date(departure.value).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(departure.value).getMinutes()).toBe(0);
    expect(departure).toHaveAccessibleDescription(/^Leaves .+ \(your local time\)$/);
  });
});
