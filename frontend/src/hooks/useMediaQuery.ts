import { useCallback, useSyncExternalStore } from "react";

/** Phones get the map with a bottom sheet; wider screens get the side panel. */
// max-width rather than range syntax (width < 768px), which Safari before 16.4 ignores.
export const PHONE_QUERY = "(max-width: 767.98px)";

/** Whether ``query`` matches, updated as the window changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
