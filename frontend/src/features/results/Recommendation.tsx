import { useId } from "react";

import { formatDuration } from "../../lib/format";
import { routeById } from "../../lib/plan";
import type { TripPlan } from "../../lib/types";
import styles from "./results.module.css";

/** The recommended route and the one-sentence reason, or a warning when no route is safe. */
export function Recommendation({ plan }: { plan: TripPlan }) {
  const titleId = useId();
  const { recommendation } = plan;
  const best = routeById(plan, recommendation.route_id);
  return (
    <section
      className={recommendation.safe ? styles.recommendation : styles.recommendationUnsafe}
      aria-labelledby={titleId}
    >
      <div className={styles.recommendationHead}>
        <span className={styles.badge}>
          {recommendation.safe ? "Recommended" : "No safe route"}
        </span>
        <h2 id={titleId} className={styles.recommendationTitle}>
          Route {recommendation.route_id}
          {best && ` · ${formatDuration(best.duration_s)}`}
        </h2>
      </div>
      <p className={styles.reason}>{recommendation.reason}</p>
      {plan.notes.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
    </section>
  );
}
