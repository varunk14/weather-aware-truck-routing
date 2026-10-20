import { useEffect, useState } from "react";

import { getHealth } from "../lib/api";

export type ApiStatus = "checking" | "online" | "offline";

export const API_RETRY_MS = 5_000;

/**
 * Checks the API health endpoint and keeps retrying while it is unreachable,
 * so a backend that is starting up is reported and then picked up once it answers.
 */
export function useApiStatus(retryMs: number = API_RETRY_MS): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        await getHealth(controller.signal);
        setStatus("online");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("offline");
        retryTimer = setTimeout(() => void check(), retryMs);
      }
    };

    void check();

    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [retryMs]);

  return status;
}
