import { useCallback, useSyncExternalStore } from "react";

/** Phones get the map with a bottom sheet; wider screens get the side panel. */
export const PHONE_QUERY = "(width < 768px)";

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
