import { useId } from "react";

import { formatClock, formatDay } from "../../lib/format";
import { hazards } from "../../lib/plan";
import { describeCauses } from "../../lib/risk";
import type { PlannedRoute } from "../../lib/types";
import styles from "./results.module.css";
import { RiskChip } from "./RiskVisuals";

interface HazardListProps {
  route: PlannedRoute;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

/**
 * The checkpoints of a route that are above Low risk. Each opens the checkpoint's details and
 * shows it on the map, so the weather along a route can be read without using the map.
 */
export function HazardList({ route, selectedIndex, onSelect }: HazardListProps) {
  const titleId = useId();
  const items = hazards(route);
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.section}>
        Weather risk on Route {route.id}
      </h3>
      {items.length === 0 ? (
        <p className={styles.calm}>
          All {route.checkpoints.length} checkpoints on Route {route.id} are Low risk.
        </p>
      ) : (
        <ul className={styles.hazards}>
          {items.map((checkpoint) => (
            <li key={checkpoint.index}>
              <button
                type="button"
                className={styles.hazard}
                aria-pressed={selectedIndex === checkpoint.index}
                onClick={() => {
                  onSelect(checkpoint.index);
                }}
              >
                <RiskChip level={checkpoint.risk.level} />
                <span className={styles.hazardMile}>
                  Mile {Math.round(checkpoint.mile).toLocaleString("en-US")}
                </span>
                <span className={styles.hazardCause}>{describeCauses(checkpoint.risk.causes)}</span>
                <span className={styles.hazardTime}>
                  {formatDay(checkpoint.eta)}, {formatClock(checkpoint.eta)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
