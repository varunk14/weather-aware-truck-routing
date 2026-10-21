/// <reference types="node" />
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { describeCauses, RISK_COLORS, RISK_LABELS, RISK_LEVELS, riskColorVar } from "./risk";

// Vitest empties CSS imports, so the token file is read from disk (tests run from frontend/).
const tokens = readFileSync("src/styles/tokens.css", "utf8");

describe("risk scale", () => {
  it("lists the levels in score order", () => {
    expect(RISK_LEVELS).toEqual(["low", "moderate", "high", "severe", "no_travel"]);
    expect(RISK_LEVELS.map((level) => RISK_LABELS[level])).toEqual([
      "Low",
      "Moderate",
      "High",
      "Severe",
      "No Travel",
    ]);
  });

  it.each(RISK_LEVELS)("uses the design token colour for %s on the map", (level) => {
    const name = `--color-risk-${level.replace("_", "-")}`;
    const token = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, "i").exec(tokens)?.[1];

    expect(token?.toLowerCase()).toBe(RISK_COLORS[level]);
    expect(riskColorVar(level)).toBe(`var(${name})`);
  });
});

describe("describeCauses", () => {
  it.each([
    [[], ""],
    [["rain"], "rain"],
    [["wind", "load"], "wind and heavy load"],
    [["wind", "rain", "snow"], "wind, rain and snow"],
  ] as const)("describes %j as %j", (causes, text) => {
    expect(describeCauses(causes)).toBe(text);
  });
});
