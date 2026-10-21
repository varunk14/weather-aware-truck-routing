import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { suggestPlaces } from "../../lib/api";
import type { Suggestion } from "../../lib/types";
import { PlaceInput } from "./PlaceInput";
import type { PlaceValue } from "./tripDraft";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  suggestPlaces: vi.fn(),
}));

const DENVER: Suggestion = {
  id: "den",
  type: "areas",
  title: "Denver, CO",
  subtitle: "United States",
};
const DENTON: Suggestion = {
  id: "dtn",
  type: "areas",
  title: "Denton, TX",
  subtitle: "United States",
};

const changes: PlaceValue[] = [];

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState<PlaceValue>({ text: "" });
  return (
    <PlaceInput
      label="Destination"
      value={value}
      error={error}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

afterEach(() => {
  vi.mocked(suggestPlaces).mockReset();
  changes.length = 0;
});

describe("PlaceInput", () => {
  it("suggests places after a short pause in typing and fills in the one picked", async () => {
    vi.mocked(suggestPlaces).mockResolvedValue([DENVER, DENTON]);
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Destination" });

    await user.type(input, "den");
    await user.click(await screen.findByRole("option", { name: /Denver, CO/ }));

    expect(input).toHaveValue("Denver, CO");
    expect(changes.at(-1)).toEqual({ text: "Denver, CO", picked: { id: "den", type: "areas" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Typing three letters quickly asks once, for the whole text.
    expect(suggestPlaces).toHaveBeenCalledTimes(1);
    expect(vi.mocked(suggestPlaces).mock.calls[0]?.[0]).toBe("den");
  });

  it("can be used with the keyboard alone", async () => {
    vi.mocked(suggestPlaces).mockResolvedValue([DENVER, DENTON]);
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Destination" });

    await user.type(input, "den");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{ArrowDown}");

    const denton = screen.getByRole("option", { name: /Denton, TX/ });
    expect(denton).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", denton.id);

    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Denton, TX");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the suggestions with Escape and keeps the typed text", async () => {
    vi.mocked(suggestPlaces).mockResolvedValue([DENVER]);
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Destination" });

    await user.type(input, "den");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("den");
    expect(changes.at(-1)).toEqual({ text: "den" });
  });

  it("does not ask for suggestions for a single letter", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("combobox", { name: "Destination" }), "d");
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(suggestPlaces).not.toHaveBeenCalled();
  });

  it("keeps working as a plain text field when suggestions fail", async () => {
    vi.mocked(suggestPlaces).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Destination" });

    await user.type(input, "Denver");
    await waitFor(() => {
      expect(suggestPlaces).toHaveBeenCalled();
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(changes.at(-1)).toEqual({ text: "Denver" });
  });

  it("links its error message to the field", () => {
    render(<Harness error="Enter where the trip ends." />);
    const input = screen.getByRole("combobox", { name: "Destination" });

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter where the trip ends.");
  });
});
