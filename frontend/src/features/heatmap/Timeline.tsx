import { type CSSProperties, useEffect, useRef } from "react";

import { addHours, formatClock, formatDay, formatOffset } from "../../lib/format";
import { RISK_COLORS, RISK_LABELS, RISK_LEVELS } from "../../lib/risk";
import {
  formatHoursAhead,
  HEAT_LAYER_LABELS,
  HEAT_LAYERS,
  type HeatLayer,
  MAX_HOUR,
  RAMPS,
} from "./heatmap";
import styles from "./Timeline.module.css";
import type { TruckPosition } from "./truck";

const TICKS = [0, 6, 12, 18, 24, 30, 36, 42, 48];
// Playing runs through the 48 hours in 12 seconds.
const PLAY_HOURS_PER_SECOND = 4;
// A frame longer than this (a tab in the background) counts as this long, so play never jumps.
const MAX_FRAME_MS = 100;
// Dragging moves in tenths of an hour; the keyboard in half hours, or 6 hours with Page keys.
const STEP = 0.1;
const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -0.5,
  ArrowDown: -0.5,
  ArrowRight: 0.5,
  ArrowUp: 0.5,
  PageDown: -6,
  PageUp: 6,
  Home: -MAX_HOUR,
  End: MAX_HOUR,
};

interface TimelineProps {
  /** The departure, with the origin's UTC offset. */
  departure: string;
  hour: number;
  onHourChange: (hour: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  layer: HeatLayer;
  onLayerChange: (layer: HeatLayer) => void;
  routeId: string;
  truck: TruckPosition | null;
  /** False when the plan came without corridor weather. */
  heatmap: boolean;
}

/**
 * The forecast timeline over the map: the time on the slider, where the truck is then, and which
 * weather the heatmap shows. Moving the slider changes what the map paints, never what it loads.
 */
export function Timeline({
  departure,
  hour,
  onHourChange,
  playing,
  onPlayingChange,
  layer,
  onLayerChange,
  routeId,
  truck,
  heatmap,
}: TimelineProps) {
  const moment = addHours(departure, hour);
  const time = `${formatDay(moment)}, ${formatClock(moment)}`;

  // Playing advances the slider with the frame clock from where it was, and stops at the end.
  const hourRef = useRef(hour);
  useEffect(() => {
    hourRef.current = hour;
  }, [hour]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last: number | null = null;
    let current = hourRef.current;
    const tick = (now: number) => {
      const elapsedMs = last === null ? 0 : Math.min(Math.max(now - last, 0), MAX_FRAME_MS);
      last = now;
      current = Math.min(current + (elapsedMs / 1000) * PLAY_HOURS_PER_SECOND, MAX_HOUR);
      onHourChange(current);
      if (current >= MAX_HOUR) onPlayingChange(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, onHourChange, onPlayingChange]);

  let truckText: string | null = null;
  if (truck) {
    truckText =
      truck.status === "arrived"
        ? `Route ${routeId} has arrived`
        : `Route ${routeId} · truck at mile ${Math.round(truck.mile).toLocaleString("en-US")}`;
  }

  return (
    <section className={styles.timeline} aria-label="Forecast timeline">
      <div className={styles.top}>
        <button
          type="button"
          className={styles.play}
          aria-label={playing ? "Pause" : "Play the next 48 hours"}
          onClick={() => {
            if (!playing && hour >= MAX_HOUR) onHourChange(0);
            onPlayingChange(!playing);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {playing ? <path d="M5 3.5v9M11 3.5v9" /> : <path d="M5 3.2v9.6L12.5 8z" />}
          </svg>
        </button>
        <p className={styles.time}>
          <span className={styles.clock}>{time}</span>
          <span className={styles.meta}>
            {formatHoursAhead(hour)} · {formatOffset(moment)}
          </span>
        </p>
        {truckText && <p className={styles.truck}>{truckText}</p>}
      </div>

      <div className={styles.slider}>
        <input
          type="range"
          min={0}
          max={MAX_HOUR}
          step={STEP}
          value={hour}
          aria-label="Forecast hours after departure"
          aria-valuetext={`${time}, ${formatHoursAhead(hour).slice(1)} after departure`}
          style={{ "--fill": `${String((hour / MAX_HOUR) * 100)}%` } as CSSProperties}
          onChange={(event) => {
            onPlayingChange(false);
            onHourChange(Number(event.target.value));
          }}
          onKeyDown={(event) => {
            const by = KEY_STEPS[event.key];
            if (by === undefined) return;
            event.preventDefault();
            onPlayingChange(false);
            onHourChange(Math.min(Math.max(Math.round((hour + by) * 2) / 2, 0), MAX_HOUR));
          }}
        />
        <div className={styles.ticks} aria-hidden="true">
          {TICKS.map((tick) => (
            <span key={tick}>{tick === MAX_HOUR ? `${String(tick)} h` : String(tick)}</span>
          ))}
        </div>
      </div>

      {heatmap ? (
        <div className={styles.bottom}>
          <div className={styles.layers} role="group" aria-label="Heatmap shows">
            {HEAT_LAYERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === layer}
                onClick={() => {
                  onLayerChange(option);
                }}
              >
                {HEAT_LAYER_LABELS[option]}
              </button>
            ))}
          </div>
          <Legend layer={layer} />
        </div>
      ) : (
        <p className={styles.unavailable}>
          The corridor weather could not be loaded for this plan; the routes are unaffected.
        </p>
      )}
    </section>
  );
}

function Legend({ layer }: { layer: HeatLayer }) {
  if (layer === "risk") {
    return (
      <ul className={styles.legend} aria-label="Risk levels">
        {RISK_LEVELS.map((level) => (
          <li key={level}>
            <span className={styles.swatch} style={{ background: RISK_COLORS[level] }} />
            {RISK_LABELS[level]}
          </li>
        ))}
      </ul>
    );
  }
  const ramp = RAMPS[layer];
  return (
    <div
      className={styles.ramp}
      role="img"
      aria-label={`${HEAT_LAYER_LABELS[layer]} scale: ${ramp.stops.join(", ")} ${ramp.unit}`}
    >
      <span
        className={styles.bar}
        style={{ background: `linear-gradient(to right, ${ramp.colors.join(", ")})` }}
      />
      <span className={styles.rampTicks}>
        {ramp.stops.map((stop) => (
          <span key={stop}>{String(stop)}</span>
        ))}
      </span>
      <span className={styles.unit}>{ramp.unit}</span>
    </div>
  );
}
