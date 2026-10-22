import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { mediaQueryList } from "../../test/media";
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
// The hour and minutes are text fields that show the digits being typed, or else their value
// as a placeholder; AM or PM is text.
const shownTime = () =>
  ["Hour", "Minutes", "AM or PM"]
    .map((name) => {
      const part = within(dialog()).getByRole("spinbutton", { name });
      return part instanceof HTMLInputElement ? part.value || part.placeholder : part.textContent;
    })
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

  it("takes digits the way a phone keyboard sends them, and asks for the number keypad", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start="2026-10-22T19:00" onChange={onChange} />);

    await user.click(trigger());
    const hour = spin("Hour");
    expect(hour).toHaveAttribute("inputmode", "numeric");
    expect(spin("Minutes")).toHaveAttribute("inputmode", "numeric");

    // Phone keyboards change the field's text without reporting the keys pressed.
    hour.focus();
    fireEvent.change(hour, { target: { value: "1" } });
    expect(shownTime()).toBe("01 00 PM");
    fireEvent.change(hour, { target: { value: "012" } });
    expect(spin("Minutes")).toHaveFocus();
    fireEvent.change(spin("Minutes"), { target: { value: "4" } });
    fireEvent.change(spin("Minutes"), { target: { value: "045" } });
    expect(shownTime()).toBe("12 45 PM");

    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-22T12:45");
  });

  it("selects nothing in a field, so a phone shows no cut and paste bar", async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-22T19:00" />);

    await user.click(trigger());
    await user.click(spin("Hour"));
    const hour = spin("Hour") as HTMLInputElement;
    expect(hour).toHaveFocus();
    // The field is empty, so there is nothing to select; the value shows as its placeholder.
    expect(hour.value).toBe("");
    expect(hour.placeholder).toBe("07");
  });

  it("clears the part being typed when a digit is deleted", async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-22T19:00" />);

    await user.click(trigger());
    const minutes = spin("Minutes") as HTMLInputElement;
    minutes.focus();
    fireEvent.change(minutes, { target: { value: "5" } });
    expect(minutes.value).toBe("05");
    // A phone's backspace leaves "0" of the "05" shown.
    fireEvent.change(minutes, { target: { value: "0" } });
    expect(minutes.value).toBe("");
    fireEvent.change(minutes, { target: { value: "3" } });
    fireEvent.change(minutes, { target: { value: "037" } });
    expect(shownTime()).toBe("07 37 PM");
  });

  it("keeps a phone's keyboard open: focus stays in the minutes and on the touched field", async () => {
    const touch = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => mediaQueryList(query, () => query === "(pointer: coarse)"));
    try {
      const user = userEvent.setup();
      render(<Harness start="2026-10-22T19:00" />);

      await user.click(trigger());
      // The hour still hands over to the minutes: both are text fields, the keyboard stays.
      const hour = spin("Hour");
      hour.focus();
      fireEvent.change(hour, { target: { value: "7" } });
      const minutes = spin("Minutes");
      expect(minutes).toHaveFocus();
      fireEvent.change(minutes, { target: { value: "4" } });
      fireEvent.change(minutes, { target: { value: "045" } });
      expect(shownTime()).toBe("07 45 PM");
      expect(minutes).toHaveFocus();

      // A touched step button changes the time without moving focus to another field.
      await user.pointer({
        keys: "[TouchA]",
        target: within(dialog()).getByRole("button", { name: "Increase hour" }),
      });
      expect(shownTime()).toBe("08 45 PM");
      expect(minutes).toHaveFocus();

      // A touch on AM or PM switches it, and focus (with the keyboard) stays in the minutes.
      await user.pointer({ keys: "[TouchA]", target: spin("AM or PM") });
      expect(shownTime()).toBe("08 45 AM");
      expect(minutes).toHaveFocus();
    } finally {
      touch.mockRestore();
    }
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
