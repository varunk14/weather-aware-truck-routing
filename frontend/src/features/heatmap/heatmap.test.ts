import { describe, expect, it } from "vitest";

import { RISK_COLORS } from "../../lib/risk";
import { heatmap } from "../../test/fixtures";
import {
  colorExpression,
  formatHoursAhead,
  framePosition,
  heatmapData,
  opacityExpression,
  RAMPS,
} from "./heatmap";

// The fixture's frames start at the departure, 08:00 -07:00 (15:00 UTC).
const DEPARTURE = "2026-10-22T08:00:00-07:00";

describe("framePosition", () => {
  it.each([
    [0, { before: 0, after: 1, fraction: 0, holding: 0 }],
    [3, { before: 3, after: 4, fraction: 0, holding: 3 }],
    [3.25, { before: 3, after: 4, fraction: 0.25, holding: 4 }],
    [48, { before: 48, after: 49, fraction: 0, holding: 48 }],
  ])("places %d hours after departure among the frames", (hours, expected) => {
    const { fraction, ...frames } = framePosition(heatmap(), DEPARTURE, hours);
    const { fraction: expectedFraction, ...expectedFrames } = expected;
    expect(frames).toEqual(expectedFrames);
    expect(fraction).toBeCloseTo(expectedFraction, 9);
  });

  it("counts from the departure, not from the first frame", () => {
    // Departing at 08:40 puts the slider's start 40 minutes into the first frame.
    const position = framePosition(heatmap(), "2026-10-22T08:40:00-07:00", 0);
    expect(position.before).toBe(0);
    expect(position.fraction).toBeCloseTo(2 / 3);
    expect(position.holding).toBe(1);
  });

  it("stays within the frames", () => {
    expect(framePosition(heatmap(), DEPARTURE, 60).before).toBe(49);
    expect(framePosition(heatmap(), "2026-10-22T07:00:00-07:00", 0).before).toBe(0);
  });
});

describe("heatmapData", () => {
  it("puts every frame on each cell as properties, once", () => {
    const data = heatmapData(heatmap());

    expect(data.features).toHaveLength(3);
    const middle = data.features[1];
    // A 0.5 degree square around the cell centre (-121.5, 46.5).
    expect(middle?.geometry.coordinates[0]).toEqual([
      [-121.75, 46.25],
      [-121.25, 46.25],
      [-121.25, 46.75],
      [-121.75, 46.75],
      [-121.75, 46.25],
    ]);
    expect(middle?.properties.r4).toBe(2);
    expect(middle?.properties.p4).toBe(0.3);
    expect(middle?.properties.w49).toBe(8);
    expect(data.features[2]?.properties.r10).toBeNull();
  });

  it("has no cells without a heatmap", () => {
    expect(heatmapData(null).features).toEqual([]);
  });
});

describe("colorExpression", () => {
  it("colours risk by the level of the frame that holds the moment", () => {
    const expression = colorExpression("risk", framePosition(heatmap(), DEPARTURE, 2.5));

    expect(expression[0]).toBe("match");
    expect(expression[1]).toEqual(["coalesce", ["get", "r3"], -1]);
    expect(expression).toContain(RISK_COLORS.high);
    // Cells without a forecast are left out.
    expect(expression[expression.length - 1]).toBe("rgba(0, 0, 0, 0)");
  });

  it("blends weather between the frames on either side", () => {
    const expression = colorExpression("rain", framePosition(heatmap(), DEPARTURE, 2.25));

    expect(JSON.stringify(expression)).toContain(
      JSON.stringify(["+", ["*", ["get", "p2"], 0.75], ["*", ["get", "p3"], 0.25]]),
    );
    expect(JSON.stringify(expression)).toContain(JSON.stringify(RAMPS.rain.colors[3]));
  });

  it("uses each layer's own values", () => {
    const position = framePosition(heatmap(), DEPARTURE, 1);
    expect(JSON.stringify(colorExpression("wind", position))).toContain('"w1"');
    expect(JSON.stringify(colorExpression("snow", position))).toContain('"s1"');
  });
});

describe("opacityExpression", () => {
  it("draws Low lighter than the other levels and leaves weather to its ramp", () => {
    const position = framePosition(heatmap(), DEPARTURE, 0);
    const risk = opacityExpression("risk", position);

    expect(Array.isArray(risk) && risk[0]).toBe("match");
    expect(opacityExpression("wind", position)).toBe(1);
  });
});

describe("formatHoursAhead", () => {
  it.each([
    [0, "+0 h"],
    [6, "+6 h"],
    [6.5, "+6.5 h"],
    [6.04, "+6 h"],
  ])("writes %d as %s", (hours, text) => {
    expect(formatHoursAhead(hours)).toBe(text);
  });
});
