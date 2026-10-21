import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Timeline } from "./Timeline";

function setup(overrides: Partial<Parameters<typeof Timeline>[0]> = {}) {
  const props = {
    departure: "2026-10-22T08:00:00-07:00",
    hour: 6.5,
    onHourChange: vi.fn(),
    playing: false,
    onPlayingChange: vi.fn(),
    layer: "risk" as const,
    onLayerChange: vi.fn(),
    routeId: "B",
    truck: { lngLat: [-121.5, 46.5] as [number, number], mile: 312.4, status: "driving" as const },
    arrivalHour: 24.5,
    heatmap: true,
    ...overrides,
  };
  render(<Timeline {...props} />);
  return props;
}

describe("Timeline", () => {
  it("shows the time on the slider and where the truck is then", () => {
    setup();

    expect(screen.getByText("Thu, Oct 22, 14:30")).toBeInTheDocument();
    expect(screen.getByText("+6.5 h · UTC−7")).toBeInTheDocument();
    expect(
      screen.getByText("Route B · truck at mile 312 · arrives at +24.5 h"),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Forecast hours after departure" })).toHaveAttribute(
      "aria-valuetext",
      "Thu, Oct 22, 14:30, 6.5 h after departure",
    );
  });

  it("says when the truck has arrived", () => {
    setup({ truck: { lngLat: [-121, 46], mile: 100, status: "arrived" } });
    expect(screen.getByText("Route B arrived at +24.5 h")).toBeInTheDocument();
  });

  it("moves the hour with the slider and stops playing", () => {
    const props = setup({ playing: true });

    fireEvent.change(screen.getByRole("slider"), { target: { value: "12.3" } });

    expect(props.onPlayingChange).toHaveBeenCalledWith(false);
    expect(props.onHourChange).toHaveBeenCalledWith(12.3);
  });

  it.each([
    ["{ArrowRight}", 7],
    ["{ArrowLeft}", 6],
    ["{PageUp}", 12.5],
    ["{PageDown}", 0.5],
    ["{End}", 48],
    ["{Home}", 0],
  ])("steps from 6.5 h with %s to %d h", async (key, hours) => {
    const user = userEvent.setup();
    const props = setup();

    screen.getByRole("slider").focus();
    await user.keyboard(key);

    expect(props.onHourChange).toHaveBeenLastCalledWith(hours);
  });

  it("plays forward at 4 hours a second and stops at the end", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const onHourChange = vi.fn<(hour: number) => void>();
      const props = setup({ hour: 46, playing: true, onHourChange });
      // Each frame is at most 100 ms, however long the browser was away.
      for (let i = 0; i < 6; i += 1) vi.advanceTimersByTime(100);

      const hours = onHourChange.mock.calls.map(([value]) => value);
      expect(hours.at(-1)).toBe(48);
      expect(hours.every((value, i) => i === 0 || value >= (hours[i - 1] ?? 0))).toBe(true);
      expect(props.onPlayingChange).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays from the start again once it has reached the end", async () => {
    const user = userEvent.setup();
    const props = setup({ hour: 48 });

    await user.click(screen.getByRole("button", { name: "Play the next 48 hours" }));

    expect(props.onHourChange).toHaveBeenCalledWith(0);
    expect(props.onPlayingChange).toHaveBeenCalledWith(true);
  });

  it("offers a pause while playing", async () => {
    const user = userEvent.setup();
    const props = setup({ playing: true });

    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(props.onPlayingChange).toHaveBeenCalledWith(false);
  });

  it("switches what the heatmap shows, with the legend for it", async () => {
    const user = userEvent.setup();
    const props = setup();

    expect(screen.getByRole("button", { name: "Risk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "Risk levels" })).toHaveTextContent(
      "LowModerateHighSevereNo Travel",
    );
    await user.click(screen.getByRole("button", { name: "Rain" }));
    expect(props.onLayerChange).toHaveBeenCalledWith("rain");
  });

  it("shows the scale and unit for a weather layer", () => {
    setup({ layer: "wind" });
    expect(
      screen.getByRole("img", { name: "Wind scale: 0, 15, 25, 35, 45, 55 mph" }),
    ).toHaveTextContent("01525354555mph");
  });

  it("explains a missing heatmap and keeps the timeline for the truck", () => {
    setup({ heatmap: false });

    expect(screen.queryByRole("group", { name: "Heatmap shows" })).not.toBeInTheDocument();
    expect(screen.getByText(/corridor weather could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });
});
