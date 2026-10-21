import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { DepartureField } from "./DepartureField";
import { departureWindow } from "./tripDraft";

// Wednesday 21 October 2026, 18:07 in the browser's time zone.
const NOW = new Date(2026, 9, 21, 18, 7);

function Harness({ start }: { start: string }) {
  const [value, setValue] = useState(start);
  return <DepartureField value={value} onChange={setValue} now={NOW} />;
}

describe("departureWindow", () => {
  it("runs from 15 minutes ago to seven days ahead", () => {
    expect(departureWindow(NOW)).toEqual({ min: "2026-10-21T17:52", max: "2026-10-28T18:07" });
  });
});

describe("DepartureField", () => {
  it("only lets the calendar pick allowed days", () => {
    render(<Harness start="2026-10-21T19:00" />);

    const input = screen.getByLabelText("Departure");
    expect(input).toHaveAttribute("min", "2026-10-21T17:52");
    expect(input).toHaveAttribute("max", "2026-10-28T18:07");
  });

  it("spells out the departure, and updates it as soon as it changes", () => {
    render(<Harness start="2026-10-21T19:00" />);
    const input = screen.getByLabelText("Departure");
    expect(input).toHaveAccessibleDescription(/^Leaves Wed, Oct 21, 7:00\sPM \(your local time\)$/);

    fireEvent.change(input, { target: { value: "2026-10-24T20:30" } });

    expect(input).toHaveValue("2026-10-24T20:30");
    expect(input).toHaveAccessibleDescription(/^Leaves Sat, Oct 24, 8:30\sPM/);
  });

  it("shows a validation message in place of the summary", () => {
    render(
      <DepartureField
        value="2026-10-21T19:00"
        onChange={() => undefined}
        error="Departure must be now or later."
        now={NOW}
      />,
    );

    const input = screen.getByLabelText("Departure");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Departure must be now or later.");
  });
});
