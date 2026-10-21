import { formatMiles } from "./format";
import type { RiskCause, RiskLevel, RouteRisk } from "./types";

/** Levels from safest to most dangerous, in the order the API scores them (0 to 4). */
export const RISK_LEVELS: readonly RiskLevel[] = ["low", "moderate", "high", "severe", "no_travel"];

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
  no_travel: "No Travel",
};

/**
 * The risk scale as hex values, for the map (MapLibre cannot read CSS variables).
 * A unit test keeps these equal to the --color-risk-* tokens used by the rest of the interface.
 */
export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#2f9e44",
  moderate: "#e8b500",
  high: "#f06a0c",
  severe: "#d92d2d",
  no_travel: "#6d3fd9",
};

export function riskColorVar(level: RiskLevel): string {
  return `var(--color-risk-${level.replace("_", "-")})`;
}

const CAUSE_LABELS: Record<RiskCause, string> = {
  wind: "wind",
  rain: "rain",
  snow: "snow",
  load: "heavy load",
};

/** "rain", "wind and heavy load", "wind, rain and snow". */
export function describeCauses(causes: readonly RiskCause[]): string {
  const words = causes.map((cause) => CAUSE_LABELS[cause]);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** "Low 797 mi, High 50 mi": the miles at each level a route has. */
export function describeRiskMiles(risk: RouteRisk): string {
  return RISK_LEVELS.filter((level) => risk.miles[level] > 0)
    .map((level) => `${RISK_LABELS[level]} ${formatMiles(risk.miles[level])}`)
    .join(", ");
}
