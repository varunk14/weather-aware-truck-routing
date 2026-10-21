import { describe, expect, it } from "vitest";

import {
  apiFieldErrors,
  emptyDraft,
  parseLoad,
  type TripDraft,
  toTripRequest,
  validateDraft,
} from "./tripDraft";

const NOW = new Date(2026, 9, 21, 9, 30);

function draft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    origin: { text: "Seattle, WA" },
    destination: { text: "Denver", picked: { id: "den", type: "areas" } },
    departure: "2026-10-21T12:00",
    load: "38,000",
    interval: 25,
    ...overrides,
  };
}

describe("emptyDraft", () => {
  it("starts at the next whole hour with 25 mile checkpoints and no places", () => {
    expect(emptyDraft(NOW)).toEqual({
      origin: { text: "" },
      destination: { text: "" },
      departure: "2026-10-21T10:00",
      load: "",
      interval: 25,
    });
  });
});

describe("parseLoad", () => {
  it.each([
    ["38,000", 38_000],
    [" 42 000 ", 42_000],
    ["1", 1],
  ])("reads %j as %s", (text, value) => {
    expect(parseLoad(text)).toBe(value);
  });

  it.each(["", "38.5", "-1", "38k", "1e4"])("rejects %j", (text) => {
    expect(parseLoad(text)).toBeUndefined();
  });
});

describe("validateDraft", () => {
  it("accepts a complete trip", () => {
    expect(validateDraft(draft(), NOW)).toEqual({});
  });

  it("asks for both places", () => {
    const errors = validateDraft(draft({ origin: { text: "  " }, destination: { text: "" } }), NOW);

    expect(errors.origin).toBe("Enter where the trip starts.");
    expect(errors.destination).toBe("Enter where the trip ends.");
  });

  it.each([
    [{ text: "Denver" }, { text: " denver " }],
    [
      { text: "Denver, CO", picked: { id: "den", type: "areas" } },
      { text: "Denver", picked: { id: "den", type: "areas" } },
    ],
  ])("rejects the same place twice", (origin, destination) => {
    expect(validateDraft(draft({ origin, destination }), NOW).destination).toBe(
      "The origin and destination are the same place.",
    );
  });

  it.each([
    ["", "Enter a departure date and time."],
    ["2026-10-21T09:00", "Departure must be now or later."],
    ["2026-10-31T10:00", "Departure must be within the next 10 days."],
  ])("checks the departure %j", (departure, message) => {
    expect(validateDraft(draft({ departure }), NOW).departure).toBe(message);
  });

  it("accepts a departure nine days ahead", () => {
    expect(validateDraft(draft({ departure: "2026-10-30T09:00" }), NOW)).toEqual({});
  });

  it("accepts a departure a few minutes ago, like the API", () => {
    expect(validateDraft(draft({ departure: "2026-10-21T09:20" }), NOW)).toEqual({});
  });

  it.each(["", "0", "80,001", "heavy"])("rejects the load %j", (load) => {
    expect(validateDraft(draft({ load }), NOW).load).toBe(
      "Enter the load in whole pounds, from 1 to 80,000.",
    );
  });

  it("accepts the legal maximum load", () => {
    expect(validateDraft(draft({ load: "80,000" }), NOW)).toEqual({});
  });
});

describe("toTripRequest", () => {
  it("sends picked places by reference and typed places as text", () => {
    const request = toTripRequest(draft());

    expect(request).toEqual({
      origin: { query: "Seattle, WA" },
      destination: { place_id: "den", place_type: "areas" },
      departure: new Date(2026, 9, 21, 12).toISOString(),
      load_lb: 38_000,
      interval_mi: 25,
    });
  });
});

describe("apiFieldErrors", () => {
  it("shows API messages on the matching form fields", () => {
    expect(
      apiFieldErrors({
        load_lb: "Too heavy.",
        interval_mi: "Not a choice.",
        destination: "Same place.",
        non_field_errors: "Something else.",
        surprise: "Unknown field.",
      }),
    ).toEqual({
      load: "Too heavy.",
      interval: "Not a choice.",
      destination: "Same place.",
      form: "Something else.",
    });
  });
});
