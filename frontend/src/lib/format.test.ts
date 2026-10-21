import { describe, expect, it } from "vitest";

import {
  addHours,
  formatClock,
  formatDay,
  formatDuration,
  formatLocalTime,
  formatMiles,
  formatOffset,
  formatWeight,
  nextWholeHour,
  toDatetimeLocal,
} from "./format";

describe("numbers", () => {
  it.each([
    [1020.9, "1,021 mi"],
    [25, "25 mi"],
    [4.36, "4.4 mi"],
    [0, "0 mi"],
  ])("formats %s miles as %s", (miles, text) => {
    expect(formatMiles(miles)).toBe(text);
  });

  it("formats weights with thousands separators", () => {
    expect(formatWeight(42_000)).toBe("42,000 lb");
  });

  it.each([
    [54_600, "15 h 10 min"],
    [3_600, "1 h 00 min"],
    [2_700, "45 min"],
    [29, "0 min"],
  ])("formats %s seconds as %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe("local times", () => {
  it("keeps the wall time of the place and labels its offset", () => {
    expect(formatLocalTime("2026-10-22T08:00:00-07:00")).toBe("Thu, Oct 22, 08:00 (UTC−7)");
  });

  it("uses the calendar date of the place, not of the viewer", () => {
    // 23:30 in Chicago is already the next day in UTC.
    expect(formatDay("2026-10-22T23:30:00-05:00")).toBe("Thu, Oct 22");
    expect(formatClock("2026-10-22T23:30:00-05:00")).toBe("23:30");
  });

  it.each([
    ["2026-10-22T08:00:00-07:00", "UTC−7"],
    ["2026-10-22T08:00:00+05:30", "UTC+5:30"],
    ["2026-10-22T08:00:00-03:30", "UTC−3:30"],
    ["2026-10-22T08:00:00+00:00", "UTC"],
    ["2026-10-22T08:00:00Z", "UTC"],
    ["2026-10-22T08:00:00.123456-06:00", "UTC−6"],
  ])("labels the offset of %s as %s", (iso, label) => {
    expect(formatOffset(iso)).toBe(label);
  });

  it("rejects times without an offset", () => {
    expect(() => formatDay("2026-10-22T08:00:00")).toThrow(RangeError);
  });
});

describe("addHours", () => {
  it.each([
    ["2026-10-22T08:00:00-07:00", 6.5, "2026-10-22T14:30-07:00"],
    ["2026-10-22T20:00:00-07:00", 5, "2026-10-23T01:00-07:00"],
    ["2026-10-22T08:00:00+05:30", 0.25, "2026-10-22T08:15+05:30"],
    ["2026-10-22T08:00:00Z", 48, "2026-10-24T08:00Z"],
  ])("moves %s by %d hours, keeping its offset", (iso, hours, expected) => {
    expect(addHours(iso, hours)).toBe(expected);
  });
});

describe("departure input", () => {
  it("formats a date for a datetime-local input in the browser's time zone", () => {
    expect(toDatetimeLocal(new Date(2026, 9, 22, 8, 5))).toBe("2026-10-22T08:05");
  });

  it("rounds up to the next whole hour", () => {
    expect(nextWholeHour(new Date(2026, 9, 22, 8, 5, 30))).toEqual(new Date(2026, 9, 22, 9));
    expect(nextWholeHour(new Date(2026, 9, 22, 23, 59))).toEqual(new Date(2026, 9, 23, 0));
  });
});
