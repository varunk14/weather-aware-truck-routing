import { useEffect, useState } from "react";

import { getHealth } from "../lib/api";

export type ApiStatus = "checking" | "waking" | "online" | "offline";

export const API_RETRY_MS = 5_000;
// The hosted API sleeps when idle and takes about a minute to wake. Until it has answered once,
// a check slower than this, or failures within the wake window, mean it is starting up.
export const API_SLOW_CHECK_MS = 4_000;
export const API_WAKE_WINDOW_MS = 90_000;

/**
 * Checks the API health endpoint and keeps retrying while it is unreachable, so a backend that
 * is starting up is reported as such, then picked up once it answers.
 */
export function useApiStatus(
  retryMs: number = API_RETRY_MS,
  wakeWindowMs: number = API_WAKE_WINDOW_MS,
): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const slowTimer = setTimeout(() => {
      setStatus((current) => (current === "checking" ? "waking" : current));
    }, API_SLOW_CHECK_MS);

    const check = async () => {
      try {
        await getHealth(controller.signal);
        clearTimeout(slowTimer);
        setStatus("online");
      } catch {
        if (controller.signal.aborted) return;
        setStatus(Date.now() - startedAt < wakeWindowMs ? "waking" : "offline");
        retryTimer = setTimeout(() => void check(), retryMs);
      }
    };

    void check();

    return () => {
      controller.abort();
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
    };
  }, [retryMs, wakeWindowMs]);

  return status;
}
