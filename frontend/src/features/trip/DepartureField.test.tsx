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

describe("departureBounds", () => {
  it("runs from 15 minutes ago to seven days ahead", () => {
    const { earliest, latest } = departureBounds(NOW);
    expect(earliest).toEqual(new Date(2026, 9, 21, 17, 52));
    expect(latest).toEqual(new Date(2026, 9, 28, 18, 7));
  });
});

describe("DepartureField", () => {
  it("shows the departure and opens the two weeks that hold the allowed days", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(trigger()).toHaveAccessibleName(/^Departure Wed, Oct 21, 7:00\sPM$/);
    expect(trigger()).toHaveAccessibleDescription("Your local time");
    await user.click(trigger());

    const calendar = dialog();
    expect(within(calendar).getByText("October 2026")).toBeInTheDocument();
    const days = within(calendar).getAllByRole("button", { name: /day, / });
    expect(days).toHaveLength(14);
    expect(days[0]).toHaveAccessibleName("Sunday, October 18");
    expect(days[13]).toHaveAccessibleName("Saturday, October 31");
    expect(within(calendar).getByRole("button", { name: "Tuesday, October 20" })).toBeDisabled();
    expect(within(calendar).getByRole("button", { name: "Wednesday, October 28" })).toBeEnabled();
    expect(within(calendar).getByRole("button", { name: "Thursday, October 29" })).toBeDisabled();
    expect(within(calendar).getByRole("button", { name: "Wednesday, October 21" })).toHaveFocus();
  });

  it("changes the departure only when Done is pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(trigger());
    await user.click(within(dialog()).getByRole("button", { name: "Saturday, October 24" }));
    await user.click(within(dialog()).getByRole("radio", { name: "30 minutes" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));

    expect(onChange).toHaveBeenCalledWith("2026-10-24T19:30");
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
    await user.keyboard("{ArrowRight}{ArrowDown}");

    expect(within(dialog()).getByRole("button", { name: "Thursday, October 29" })).toBeDisabled();
    // Wednesday 28 (a week after Thursday 22 would be outside the window) is as far as it goes.
    expect(within(dialog()).getByRole("button", { name: "Thursday, October 22" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not offer times that have already passed today", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    const hours = within(dialog()).getByRole("radiogroup", { name: "Hour" });

    expect(within(hours).getByRole("radio", { name: "5 PM" })).toBeDisabled();
    expect(within(hours).getByRole("radio", { name: "6 PM" })).toBeEnabled();
    expect(within(hours).getByRole("radio", { name: "7 PM" })).toBeChecked();
    expect(within(dialog()).getByRole("radio", { name: "AM" })).toBeDisabled();
  });

  it("moves the time with the arrow keys, skipping times that have passed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(trigger());
    within(dialog()).getByRole("radio", { name: "7 PM" }).focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    const hours = within(dialog()).getByRole("radiogroup", { name: "Hour" });
    // 6 PM is the earliest hour left today, so the second press goes nowhere.
    expect(within(hours).getByRole("radio", { name: "6 PM" })).toBeChecked();
    expect(within(hours).getByRole("radio", { name: "6 PM" })).toHaveFocus();

    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(within(hours).getByRole("radio", { name: "1 PM" })).not.toBeChecked();
    expect(within(hours).getByRole("radio", { name: "7 PM" })).toBeChecked();

    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-21T19:00");
  });

  it("names the new month when the two weeks span two", async () => {
    const user = userEvent.setup();
    render(
      <DepartureField
        value="2026-10-28T09:00"
        onChange={() => undefined}
        now={new Date(2026, 9, 28, 8, 0)}
      />,
    );

    await user.click(trigger());
    expect(within(dialog()).getByText(/October\s.\sNovember 2026/)).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Wednesday, November 4" })).toBeEnabled();
    expect(within(dialog()).getByRole("button", { name: "Sunday, November 1" })).toHaveTextContent(
      "Nov1",
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
