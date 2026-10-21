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

export type SheetSnap = "peek" | "half" | "full";

const ORDER: readonly SheetSnap[] = ["peek", "half", "full"];
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
  /** Always visible at the top of the sheet; its height sets the peek position. */
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

function step(snap: SheetSnap, by: number): SheetSnap {
  const index = Math.min(Math.max(ORDER.indexOf(snap) + by, 0), ORDER.length - 1);
  return ORDER[index] ?? snap;
}

/**
 * A panel over the bottom of the map with three positions: peek, half and full. The handle is a
 * button: tap or Enter cycles through the positions and the arrow keys step up and down. The
 * top of the sheet can also be dragged; it settles at the nearest position.
 */
export function BottomSheet({
  label,
  snap,
  onSnapChange,
  onHeightChange,
  peek,
  children,
}: BottomSheetProps) {
  const contentId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const [space, setSpace] = useState({ available: 0, peek: 0 });
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // Height changes animate only after the first measurement, so the sheet does not grow from
  // nothing when the page opens.
  const [animated, setAnimated] = useState(false);

  const measure = useCallback(() => {
    const container = sheetRef.current?.parentElement;
    const peekContent = peekRef.current;
    if (!container || !peekContent) return;
    // scrollHeight: the content's full height, even while it is capped and scrolls.
    const next = { available: container.clientHeight, peek: peekContent.scrollHeight };
    // Same numbers keep the same state, so measuring after every render cannot loop.
    setSpace((current) =>
      current.available === next.available && current.peek === next.peek ? current : next,
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
    const hiddenInside = snap === "peek" && contentRef.current?.contains(active);
    if (lostInside || hiddenInside) handleRef.current?.focus({ preventScroll: true });
  });

  // The screen and the content can also change size without a render (rotation, fonts).
  useLayoutEffect(() => {
    const container = sheetRef.current?.parentElement;
    const peekContent = peekRef.current;
    if (!container || !peekContent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(peekContent);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  // Peek content taller than its share of the screen (short phones, large text) scrolls.
  const maxPeek = space.available * MAX_PEEK_SHARE;
  const peekOverflows = space.available > 0 && HANDLE_HEIGHT + space.peek > maxPeek;
  const peekHeight = Math.min(HANDLE_HEIGHT + space.peek, maxPeek);
  const heights: Record<SheetSnap, number> = {
    peek: peekHeight,
    half: Math.max(space.available * HALF_SHARE, peekHeight),
    full: Math.max(space.available - FULL_GAP, peekHeight),
  };
  const settled = Math.round(heights[snap]);

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
    if (snap === "peek" && contentRef.current) contentRef.current.scrollTop = 0;
  }, [snap]);

  // Window listeners follow a press until it ends, wherever the pointer goes; they read the
  // latest sizes and callback through this ref.
  const latest = useRef({ heights, onSnapChange });
  useEffect(() => {
    latest.current = { heights, onSnapChange };
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
      const { heights: current } = latest.current;
      drag.height = Math.min(Math.max(drag.startHeight + moved, current.peek * 0.8), current.full);
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
      const { heights: current, onSnapChange: settle } = latest.current;
      const nearest = ORDER.reduce((best, candidate) =>
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
    onSnapChange(snap === "full" ? "peek" : step(snap, 1));
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onSnapChange(step(snap, event.key === "ArrowUp" ? 1 : -1));
    }
  }

  return (
    <section
      ref={sheetRef}
      className={styles.sheet}
      style={{ height: dragHeight ?? settled }}
      data-snap={snap}
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
            snap === "full" ? "Show less of the trip panel" : "Show more of the trip panel"
          }
          aria-expanded={snap !== "peek"}
          aria-controls={contentId}
          onClick={onHandleClick}
          onKeyDown={onHandleKeyDown}
        >
          <span aria-hidden="true" />
        </button>
        <div
          ref={peekRef}
          className={styles.peek}
          style={peekOverflows ? { maxHeight: maxPeek - HANDLE_HEIGHT } : undefined}
        >
          {peek}
        </div>
      </div>
      <div ref={contentRef} id={contentId} className={styles.content} inert={snap === "peek"}>
        {children}
      </div>
    </section>
  );
}
