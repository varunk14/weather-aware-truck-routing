import { useCallback, useRef, useState } from "react";

/**
 * The rendered height of an element, kept up to date as it changes size. Attach the returned
 * ref to the element; the height is 0 until it is measured and after it is removed.
 */
export function useElementHeight(): [(element: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) {
      setHeight(0);
      return;
    }
    setHeight(element.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.target.getBoundingClientRect().height);
    });
    observer.current.observe(element);
  }, []);

  return [ref, height];
}
