import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { DepartureField } from "./DepartureField";
import { departureDays, departureTimes } from "./tripDraft";

// Wednesday 21 October 2026, 18:07 in the browser's time zone.
const NOW = new Date(2026, 9, 21, 18, 7);

function Harness({ start }: { start: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <DepartureField value={value} onChange={setValue} now={NOW} />
      <output>{value}</output>
    </>
  );
}

describe("departure days and times", () => {
  it("offers today and the next seven days", () => {
    expect(departureDays(NOW).map((day) => day.label)).toEqual([
      "Today",
      "Tomorrow",
      "Fri 23",
      "Sat 24",
      "Sun 25",
      "Mon 26",
      "Tue 27",
      "Wed 28",
    ]);
  });

  it("offers no past times today, beyond the 15 minute grace", () => {
    const today = departureTimes(NOW, NOW);

    expect(today[0]).toBe("18:00");
    expect(today.at(-1)).toBe("23:45");
  });

  it("offers nothing after the seven-day window on the last day", () => {
    const lastDay = departureDays(NOW).at(-1)?.date ?? NOW;

    expect(departureTimes(lastDay, NOW).at(-1)).toBe("18:00");
    expect(departureTimes(lastDay, NOW)[0]).toBe("00:00");
  });
});

describe("DepartureField", () => {
  it("applies a day at once and keeps the time", async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-21T19:00" />);

    expect(screen.getByRole("radio", { name: "Today" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Sat 24" }));

    expect(screen.getByText("2026-10-24T19:00")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Departure time" })).toHaveAccessibleDescription(
      /^Leaves Sat, Oct 24/,
    );
  });

  it("moves to the first time still available when today is picked", async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-24T07:00" />);

    await user.click(screen.getByRole("radio", { name: "Today" }));

    expect(screen.getByText("2026-10-21T18:00")).toBeInTheDocument();
  });

  it("applies a time at once", async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-22T09:00" />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Departure time" }), "14:30");

    expect(screen.getByText("2026-10-22T14:30")).toBeInTheDocument();
  });

  it("shows a validation message on the time list", () => {
    render(
      <DepartureField
        value="2026-10-21T19:00"
        onChange={() => undefined}
        error="Departure must be now or later."
        now={NOW}
      />,
    );

    const time = screen.getByRole("combobox", { name: "Departure time" });
    expect(time).toHaveAttribute("aria-invalid", "true");
    expect(time).toHaveAccessibleDescription("Departure must be now or later.");
  });
});
