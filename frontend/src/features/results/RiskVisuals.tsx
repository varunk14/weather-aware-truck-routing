import type { CSSProperties } from "react";

import { describeRiskMiles, RISK_LABELS, RISK_LEVELS, riskColorVar } from "../../lib/risk";
import type { RiskLevel, RouteRisk } from "../../lib/types";
import styles from "./results.module.css";

function riskStyle(level: RiskLevel): CSSProperties {
  return { "--risk": riskColorVar(level) } as CSSProperties;
}

/** A level shown as a coloured dot and its name, never as colour alone. */
export function RiskChip({ level }: { level: RiskLevel }) {
  return (
    <span className={styles.chip} style={riskStyle(level)}>
      {RISK_LABELS[level]}
    </span>
  );
}

/** Miles at each level as one stacked bar, with the same numbers in its accessible name. */
export function RiskBar({ risk }: { risk: RouteRisk }) {
  const levels = RISK_LEVELS.filter((level) => risk.miles[level] > 0);
  return (
    <span
      className={styles.bar}
      role="img"
      aria-label={`Miles by risk level: ${describeRiskMiles(risk)}`}
    >
      {levels.map((level) => (
        <span
          key={level}
          className={styles.barPart}
          style={{ flexGrow: risk.miles[level], background: riskColorVar(level) }}
        />
      ))}
    </span>
  );
}

export function RiskLegend() {
  return (
    <ul className={styles.legend} aria-label="Risk levels">
      {RISK_LEVELS.map((level) => (
        <li key={level} style={riskStyle(level)}>
          {RISK_LABELS[level]}
        </li>
      ))}
    </ul>
  );
}

/** The route's end markers, as drawn on the map. */
export function MarkerLegend() {
  return (
    <ul className={styles.legend} aria-label="Map markers">
      <li className={styles.start}>Start</li>
      <li className={styles.end}>End</li>
    </ul>
  );
}
