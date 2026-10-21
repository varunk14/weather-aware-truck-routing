import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DepartureField } from "./DepartureField";
import { departureBounds } from "./tripDraft";

// Wednesday 21 October 2026, 18:07 in the browser's time zone.
const NOW = new Date(2026, 9, 21, 18, 7);

function Harness({ start = "2026-10-21T19:00", onChange = vi.fn() }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <DepartureField
        value={value}
        now={NOW}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
      <p>Outside</p>
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: /^Departure/ });
const dialog = () => screen.getByRole("dialog", { name: "Choose the departure" });
const spin = (name: "Hour" | "Minutes" | "AM or PM") =>
  within(dialog()).getByRole("spinbutton", { name });
const shownTime = () =>
  ["Hour", "Minutes", "AM or PM"]
    .map((name) => within(dialog()).getByRole("spinbutton", { name }).textContent)
    .join(" ");

describe("departureBounds", () => {
  it("runs from 15 minutes ago to ten days ahead", () => {
    const { earliest, latest } = departureBounds(NOW);
    expect(earliest).toEqual(new Date(2026, 9, 21, 17, 52));
    expect(latest).toEqual(new Date(2026, 9, 31, 18, 7));
  });
});

describe("DepartureField", () => {
  it("shows the departure and opens a month in which only the allowed days can be picked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(trigger()).toHaveAccessibleName(/^Departure Wed, Oct 21, 7:00\sPM$/);
    expect(trigger()).toHaveAccessibleDescription("Your local time");
    await user.click(trigger());

    const calendar = dialog();
    expect(within(calendar).getByText("October 2026")).toBeInTheDocument();
    const days = within(calendar).getAllByRole("button", { name: /day, / });
    expect(days).toHaveLength(42);
    expect(days[0]).toHaveAccessibleName("Sunday, September 27");
    expect(within(calendar).getByRole("button", { name: "Tuesday, October 20" })).toBeDisabled();
    expect(within(calendar).getByRole("button", { name: "Saturday, October 31" })).toBeEnabled();
    expect(within(calendar).getByRole("button", { name: "Sunday, November 1" })).toBeDisabled();
    expect(within(calendar).getByRole("button", { name: "Wednesday, October 21" })).toHaveFocus();
    expect(shownTime()).toBe("07 00 PM");
  });

  it("changes the departure only when Done is pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(trigger());
    await user.click(within(dialog()).getByRole("button", { name: "Saturday, October 24" }));
    await user.click(spin("Minutes"));
    await user.keyboard("37");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));

    expect(onChange).toHaveBeenCalledWith("2026-10-24T19:37");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it.each([
    [
      "Cancel",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
      },
    ],
    [
      "Escape",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.keyboard("{Escape}");
      },
    ],
    [
      "a click outside",
      () => {
        fireEvent.pointerDown(screen.getByText("Outside"));
        return Promise.resolve();
      },
    ],
  ])("keeps the departure when closed with %s", async (_, dismiss) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(trigger());
    await user.click(within(dialog()).getByRole("button", { name: "Friday, October 23" }));
    await dismiss(user);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves between days with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.keyboard("{ArrowRight}{ArrowDown}{ArrowDown}");

    // Thursday 29 is in the window; a week later is not, so the second press goes nowhere.
    expect(within(dialog()).getByRole("button", { name: "Thursday, October 29" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("takes a typed time, moving on from the hour to the minutes to AM or PM", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start="2026-10-22T19:00" onChange={onChange} />);

    await user.click(trigger());
    await user.click(spin("Hour"));
    await user.keyboard("11");
    expect(spin("Minutes")).toHaveFocus();
    await user.keyboard("5");
    expect(shownTime()).toBe("11 05 PM");
    await user.keyboard("9");
    expect(spin("AM or PM")).toHaveFocus();
    await user.keyboard("a");
    expect(shownTime()).toBe("11 59 AM");

    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-22T11:59");
  });

  it("steps each part up and down, with the arrow keys or the buttons", async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-22T23:59" />);

    await user.click(trigger());
    await user.click(spin("Minutes"));
    await user.keyboard("{ArrowUp}");
    expect(shownTime()).toBe("11 00 PM");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(shownTime()).toBe("11 58 PM");

    await user.click(within(dialog()).getByRole("button", { name: "Increase hour" }));
    expect(shownTime()).toBe("12 58 PM");
    expect(spin("Hour")).toHaveFocus();
    await user.click(within(dialog()).getByRole("button", { name: "Decrease am or pm" }));
    expect(shownTime()).toBe("12 58 AM");
  });

  it("will not take a time that has passed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(trigger());
    await user.click(spin("Hour"));
    await user.keyboard("5");

    expect(within(dialog()).getByRole("alert")).toHaveTextContent("That time has already passed.");
    expect(spin("Hour")).toHaveAttribute("aria-invalid", "true");
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();

    // A later day makes the same time fine.
    await user.click(within(dialog()).getByRole("button", { name: "Thursday, October 22" }));
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-22T17:00");
  });

  it("pages to the next month when the allowed days run into it", async () => {
    const user = userEvent.setup();
    render(
      <DepartureField
        value="2026-10-28T09:00"
        onChange={() => undefined}
        now={new Date(2026, 9, 28, 8, 0)}
      />,
    );

    await user.click(trigger());
    expect(within(dialog()).getByText("October 2026")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Previous month" })).toBeDisabled();
    await user.click(within(dialog()).getByRole("button", { name: "Next month" }));

    expect(within(dialog()).getByText("November 2026")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Next month" })).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Saturday, November 7" })).toBeEnabled();
    expect(within(dialog()).getByRole("button", { name: "Sunday, November 8" })).toBeDisabled();
  });

  it("says when the forecast that far ahead is less certain", () => {
    render(<DepartureField value="2026-10-30T09:00" onChange={() => undefined} now={NOW} />);

    expect(trigger()).toHaveAccessibleDescription(
      "Your local time. Forecasts more than a week ahead are less certain.",
    );
  });

  it("shows a validation message instead of the hint", () => {
    render(
      <DepartureField
        value="2026-10-21T19:00"
        onChange={() => undefined}
        error="Departure must be now or later."
        now={NOW}
      />,
    );

    expect(trigger()).toHaveAttribute("aria-invalid", "true");
    expect(trigger()).toHaveAccessibleDescription("Departure must be now or later.");
  });
});
