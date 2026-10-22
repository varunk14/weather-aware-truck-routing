import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import styles from "./BottomSheet.module.css";

export type SheetSnap = "bar" | "peek" | "half" | "full";

const ORDER: readonly SheetSnap[] = ["bar", "peek", "half", "full"];
// Without bar content the sheet has no bar position; "bar" then means its lowest, the peek.
const WITHOUT_BAR: readonly SheetSnap[] = ["peek", "half", "full"];
// The handle is a full-width button, 44 px tall so it is easy to hit.
const HANDLE_HEIGHT = 44;
const HALF_SHARE = 0.55;
const MAX_PEEK_SHARE = 0.45;
const FULL_GAP = 8;
/** Movement before a press on the sheet's top becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 6;

interface BottomSheetProps {
  label: string;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Height of the settled sheet, so the map can keep its content clear of it. */
  onHeightChange?: (height: number) => void;
  /**
   * Optional: always visible at the very top, above the peek content. With it the sheet has a
   * lowest position, the bar, that shows only this and leaves the most of the map in view.
   */
  bar?: ReactNode;
  /** Visible at the top of the sheet from the peek position up; with the bar it sets the peek. */
  peek: ReactNode;
  /** Shown below the peek content at the half and full positions. */
  children?: ReactNode;
}

interface Drag {
  pointerId: number;
  startY: number;
  startHeight: number;
  height: number | null;
}

function step(order: readonly SheetSnap[], snap: SheetSnap, by: number): SheetSnap {
  const index = Math.min(Math.max(order.indexOf(snap) + by, 0), order.length - 1);
  return order[index] ?? snap;
}

/**
 * A panel over the bottom of the map with three positions, peek, half and full, and with bar
 * content a fourth, lowest one: the bar. The handle is a button: tap or Enter cycles through the
 * positions and the arrow keys step up and down. The top of the sheet can also be dragged; it
 * settles at the nearest position.
 */
export function BottomSheet({
  label,
  snap,
  onSnapChange,
  onHeightChange,
  bar,
  peek,
  children,
}: BottomSheetProps) {
  const hasBar = bar !== undefined;
  const order = hasBar ? ORDER : WITHOUT_BAR;
  const lowest = order[0] ?? "peek";
  // A sheet without a bar asked to show it shows its lowest position instead.
  const shown: SheetSnap = order.includes(snap) ? snap : lowest;
  const contentId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const [space, setSpace] = useState({ available: 0, bar: 0, peek: 0 });
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // Height changes animate only after the first measurement, so the sheet does not grow from
  // nothing when the page opens.
  const [animated, setAnimated] = useState(false);

  const measure = useCallback(() => {
    const container = sheetRef.current?.parentElement;
    const peekContent = peekRef.current;
    if (!container || !peekContent) return;
    // scrollHeight: the content's full height, even while it is capped and scrolls.
    const next = {
      available: container.clientHeight,
      bar: barRef.current?.scrollHeight ?? 0,
      peek: peekContent.scrollHeight,
    };
    // Same numbers keep the same state, so measuring after every render cannot loop.
    setSpace((current) =>
      current.available === next.available && current.bar === next.bar && current.peek === next.peek
        ? current
        : next,
    );
  }, []);

  // The peek content changes with what the sheet shows; size the sheet to it before paint.
  useLayoutEffect(measure);

  // Content can vanish under the keyboard focus: lowering the sheet makes it inert, and a new
  // view replaces it. Focus then moves to the handle instead of falling back to the page.
  const handleRef = useRef<HTMLButtonElement>(null);
  const focusWasInside = useRef(false);
  useLayoutEffect(() => {
    const active = document.activeElement;
    const lostInside = active === document.body && focusWasInside.current;
    const lowered = shown === "bar" || shown === "peek";
    const hiddenInside =
      (lowered && contentRef.current?.contains(active) === true) ||
      (shown === "bar" && peekRef.current?.contains(active) === true);
    if (lostInside || hiddenInside) handleRef.current?.focus({ preventScroll: true });
  });

  // The screen and the content can also change size without a render (rotation, fonts). The bar
  // comes and goes with what the sheet shows, so it is observed again whenever it appears.
  useLayoutEffect(() => {
    const container = sheetRef.current?.parentElement;
    const peekContent = peekRef.current;
    if (!container || !peekContent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(peekContent);
    if (barRef.current) observer.observe(barRef.current);
    return () => {
      observer.disconnect();
    };
  }, [measure, hasBar]);

  // Peek content taller than its share of the screen (short phones, large text) scrolls.
  const maxPeek = space.available * MAX_PEEK_SHARE;
  const top = HANDLE_HEIGHT + space.bar;
  const peekOverflows = space.available > 0 && top + space.peek > maxPeek;
  const barHeight = Math.min(top, maxPeek);
  const peekHeight = Math.min(top + space.peek, maxPeek);
  const heights: Record<SheetSnap, number> = {
    bar: barHeight,
    peek: peekHeight,
    half: Math.max(space.available * HALF_SHARE, peekHeight),
    full: Math.max(space.available - FULL_GAP, peekHeight),
  };
  const settled = Math.round(heights[shown]);

  useEffect(() => {
    if (settled > 0) onHeightChange?.(settled);
  }, [settled, onHeightChange]);

  const measured = space.available > 0;
  useEffect(() => {
    if (!measured || animated) return;
    const frame = requestAnimationFrame(() => {
      setAnimated(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [measured, animated]);

  useEffect(() => {
    if ((shown === "bar" || shown === "peek") && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [shown]);

  // Window listeners follow a press until it ends, wherever the pointer goes; they read the
  // latest sizes, positions and callback through this ref.
  const latest = useRef({ heights, order, onSnapChange });
  useEffect(() => {
    latest.current = { heights, order, onSnapChange };
  });
  const stopDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      stopDragRef.current?.();
    },
    [],
  );

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    stopDragRef.current?.();
    const drag: Drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: settled,
      height: null,
    };
    draggedRef.current = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      const moved = drag.startY - moveEvent.clientY;
      // Small movements stay taps, so buttons in the sheet still get their clicks.
      if (drag.height === null && Math.abs(moved) < DRAG_THRESHOLD) return;
      const { heights: current, order: positions } = latest.current;
      const floor = current[positions[0] ?? "peek"] * 0.8;
      drag.height = Math.min(Math.max(drag.startHeight + moved, floor), current.full);
      draggedRef.current = true;
      setDragHeight(drag.height);
    };
    const end = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== drag.pointerId) return;
      stop();
      const height = drag.height;
      if (height === null) return;
      // The click that may follow this release belongs to the drag; later clicks do not.
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
      const { heights: current, order: positions, onSnapChange: settle } = latest.current;
      const nearest = positions.reduce((best, candidate) =>
        Math.abs(current[candidate] - height) < Math.abs(current[best] - height) ? candidate : best,
      );
      setDragHeight(null);
      settle(nearest);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopDragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    stopDragRef.current = stop;
  }

  function onHandleClick() {
    // A drag that started on the handle ends in a click; it has already moved the sheet.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onSnapChange(shown === "full" ? lowest : step(order, shown, 1));
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onSnapChange(step(order, shown, event.key === "ArrowUp" ? 1 : -1));
    }
  }

  return (
    <section
      ref={sheetRef}
      className={styles.sheet}
      style={{ height: dragHeight ?? settled }}
      data-snap={shown}
      data-dragging={dragHeight !== null || undefined}
      data-animated={animated || undefined}
      data-peek-overflows={peekOverflows || undefined}
      aria-label={label}
      onFocus={() => {
        focusWasInside.current = true;
      }}
      onBlur={(event) => {
        // Focus moved to something else on the page (not lost into nothing).
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          focusWasInside.current = false;
        }
      }}
    >
      <div className={styles.grab} onPointerDown={onPointerDown}>
        <button
          ref={handleRef}
          type="button"
          className={styles.handle}
          aria-label={
            shown === "full" ? "Show less of the trip panel" : "Show more of the trip panel"
          }
          aria-expanded={shown === "half" || shown === "full"}
          aria-controls={contentId}
          onClick={onHandleClick}
          onKeyDown={onHandleKeyDown}
        >
          <span aria-hidden="true" />
        </button>
        {hasBar && (
          <div ref={barRef} className={styles.bar}>
            {bar}
          </div>
        )}
        <div
          ref={peekRef}
          className={styles.peek}
          style={peekOverflows ? { maxHeight: Math.max(maxPeek - top, 0) } : undefined}
          inert={shown === "bar"}
        >
          {peek}
        </div>
      </div>
      <div
        ref={contentRef}
        id={contentId}
        className={styles.content}
        inert={shown === "bar" || shown === "peek"}
      >
        {children}
      </div>
    </section>
  );
}
