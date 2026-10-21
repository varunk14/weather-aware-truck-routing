import { useId } from "react";

import { formatDuration, formatLocalTime, formatMiles } from "../../lib/format";
import { severePlusMiles } from "../../lib/plan";
import { describeRiskMiles } from "../../lib/risk";
import type { PlannedRoute } from "../../lib/types";
import styles from "./results.module.css";
import { RiskBar } from "./RiskVisuals";

const PLACES = ["", "1st", "2nd", "3rd"];

interface RouteCardProps {
  route: PlannedRoute;
  recommended: boolean;
  selected: boolean;
  onSelect: (routeId: string) => void;
}

export function RouteCard({ route, recommended, selected, onSelect }: RouteCardProps) {
  const id = useId();
  const { risk } = route;
  const place = recommended
    ? "recommended"
    : `${PLACES[route.rank] ?? `#${String(route.rank)}`} choice`;
  return (
    <button
      type="button"
      className={styles.card}
      aria-pressed={selected}
      // A short name for the button; the numbers are read as its description.
      aria-label={`Route ${route.id}, ${place}${route.detour ? ", detour" : ""}`}
      aria-describedby={id}
      onClick={() => {
        onSelect(route.id);
      }}
    >
      <span className={styles.cardHead}>
        <span className={styles.letter}>{route.id}</span>
        <span className={recommended ? styles.tagBest : styles.tag}>
          {recommended ? "Recommended" : (PLACES[route.rank] ?? `#${String(route.rank)}`)}
        </span>
        {route.detour && <span className={styles.tag}>Detour</span>}
        <span className={styles.duration}>{formatDuration(route.duration_s)}</span>
      </span>
      <span className={styles.cardMeta}>
        {formatMiles(route.distance_mi)} · arrives {formatLocalTime(route.arrival)}
      </span>
      <RiskBar risk={risk} />
      <span className={styles.stats}>
        <span>
          <b>{formatMiles(severePlusMiles(risk))}</b> Severe+
        </span>
        <span>
          <b>{formatMiles(risk.miles.high)}</b> High
        </span>
        <span>
          <b>{risk.average.toFixed(2)}</b> Avg risk
        </span>
        <span>
          <b>{route.checkpoints.length}</b> Checkpoints
        </span>
      </span>
      <span id={id} className="visually-hidden">
        {`${formatDuration(route.duration_s)}, ${formatMiles(route.distance_mi)}, arrives ` +
          `${formatLocalTime(route.arrival)}. ${describeRiskMiles(risk)}. ` +
          `Average risk ${risk.average.toFixed(2)}, ${String(route.checkpoints.length)} checkpoints.`}
      </span>
    </button>
  );
}
