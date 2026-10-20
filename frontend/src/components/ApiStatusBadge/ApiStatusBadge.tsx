import type { ApiStatus } from "../../hooks/useApiStatus";
import styles from "./ApiStatusBadge.module.css";

const LABELS: Record<ApiStatus, string> = {
  checking: "Connecting to API",
  online: "API online",
  offline: "API unavailable, retrying",
};

interface ApiStatusBadgeProps {
  status: ApiStatus;
}

export function ApiStatusBadge({ status }: ApiStatusBadgeProps) {
  return (
    <span role="status" className={styles.badge} data-status={status}>
      <span className={styles.dot} aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
