import { useEffect, useId, useState } from "react";

import type { ApiError } from "../../lib/api";
import styles from "./results.module.css";

/** After this long the message admits that a service is slow, so a long wait is not a surprise. */
export const SLOW_AFTER_S = 15;

interface LoadingStateProps {
  startedAt: number;
  onCancel: () => void;
}

export function LoadingState({ startedAt, onCancel }: LoadingStateProps) {
  const titleId = useId();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const slow = seconds >= SLOW_AFTER_S;

  return (
    <section className={styles.loading} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.loadingTitle}>
        Planning three truck routes
      </h2>
      <div className={styles.track} aria-hidden="true">
        <span />
      </div>
      {/* Announced once, and again only if the wait gets long; the seconds are not read out. */}
      <p className={styles.loadingText} role="status">
        {slow
          ? "Still working. The routing or weather service is slow right now."
          : "Finding routes, then checking the weather at every checkpoint. This usually takes about 5 seconds; very long trips take up to 20."}
      </p>
      <p className={styles.elapsed} aria-hidden="true">
        {seconds} s
      </p>
      <button type="button" className={styles.secondary} onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}

interface ErrorStateProps {
  error: ApiError;
  onRetry: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  // A trip the API cannot route will not work on retry; everything else may.
  const canRetry = error.status !== 422;
  return (
    <section className={styles.errorBox} role="alert">
      <h2 className={styles.errorTitle}>The trip could not be planned</h2>
      <p>{error.message}</p>
      {canRetry && (
        <button type="button" className={styles.secondary} onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}
