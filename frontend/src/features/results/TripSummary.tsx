import { formatLocalTime, formatWeight } from "../../lib/format";
import type { TripPlan } from "../../lib/types";
import styles from "./results.module.css";

interface TripSummaryProps {
  plan: TripPlan;
  onEdit?: () => void;
}

/** The planned trip in two lines, with a way back to the form. */
export function TripSummary({ plan, onEdit }: TripSummaryProps) {
  const departure = plan.routes[0]?.departure;
  return (
    <div className={styles.summary}>
      <div className={styles.summaryText}>
        <p className={styles.summaryPlaces}>
          {plan.origin.title} <span aria-hidden="true">→</span>
          <span className="visually-hidden"> to </span> {plan.destination.title}
        </p>
        <p className={styles.summaryMeta}>
          {departure && `${formatLocalTime(departure)} · `}
          {formatWeight(plan.load_lb)} · every {plan.interval_mi} mi
        </p>
      </div>
      {onEdit && (
        <button type="button" className={styles.secondary} onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  );
}
