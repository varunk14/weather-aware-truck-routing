import { type KeyboardEvent, useRef } from "react";

import styles from "./TimeInput.module.css";

type Segment = "hour" | "minute" | "half";
const ORDER: readonly Segment[] = ["hour", "minute", "half"];
const NAMES: Record<Segment, string> = { hour: "Hour", minute: "Minutes", half: "AM or PM" };

const pad = (value: number) => String(value).padStart(2, "0");

interface TimeInputProps {
  /** 0 to 23. */
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  /** Labels the whole time, for example the id of a visible "Time" label. */
  labelledBy: string;
  describedBy?: string;
  invalid?: boolean;
}

/**
 * A time typed or stepped like the browser's own time input: an hour, minutes and AM or PM,
 * each a spin button. Type digits (the next part takes over once one is complete), use the up
 * and down arrows or the buttons above and below, and the left and right arrows to move.
 */
export function TimeInput({
  hour,
  minute,
  onChange,
  labelledBy,
  describedBy,
  invalid,
}: TimeInputProps) {
  const refs = {
    hour: useRef<HTMLSpanElement>(null),
    minute: useRef<HTMLSpanElement>(null),
    half: useRef<HTMLSpanElement>(null),
  };
  // The digits typed so far into one part, so "1" then "2" makes 12.
  const typed = useRef<{ segment: Segment; digits: string } | null>(null);

  const pm = hour >= 12;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const setHour12 = (value: number) => {
    onChange((value % 12) + (pm ? 12 : 0), minute);
  };

  function focus(segment: Segment | undefined) {
    typed.current = null;
    if (segment) refs[segment].current?.focus();
  }

  function step(segment: Segment, by: 1 | -1) {
    typed.current = null;
    if (segment === "hour") setHour12(((hour12 - 1 + by + 12) % 12) + 1);
    else if (segment === "minute") onChange(hour, (minute + by + 60) % 60);
    else onChange((hour + 12) % 24, minute);
  }

  function type(segment: Segment, digit: number) {
    const before = typed.current?.segment === segment ? typed.current.digits : "";
    let digits = before + String(digit);
    const limit = segment === "hour" ? 12 : 59;
    if (Number(digits) > limit || (segment === "hour" && digits === "00")) digits = String(digit);
    const value = Number(digits);
    if (segment === "hour") {
      if (value > 0) setHour12(value);
    } else {
      onChange(hour, value);
    }
    // Complete once two digits are in, or when no second digit could follow the first.
    const complete = digits.length === 2 || value * 10 > limit;
    if (complete) focus(ORDER[ORDER.indexOf(segment) + 1]);
    else typed.current = { segment, digits };
  }

  function onKeyDown(segment: Segment, event: KeyboardEvent<HTMLSpanElement>) {
    const index = ORDER.indexOf(segment);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(segment, event.key === "ArrowUp" ? 1 : -1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focus(ORDER[index + (event.key === "ArrowLeft" ? -1 : 1)] ?? segment);
    } else if (segment === "half" && /^[ap]$/i.test(event.key)) {
      event.preventDefault();
      if (event.key.toLowerCase() === (pm ? "a" : "p")) step("half", 1);
    } else if (segment !== "half" && /^\d$/.test(event.key)) {
      event.preventDefault();
      type(segment, Number(event.key));
    }
  }

  const parts: Record<Segment, { text: string; now: number; min: number; max: number }> = {
    hour: { text: pad(hour12), now: hour12, min: 1, max: 12 },
    minute: { text: pad(minute), now: minute, min: 0, max: 59 },
    half: { text: pm ? "PM" : "AM", now: pm ? 1 : 0, min: 0, max: 1 },
  };

  return (
    <div
      className={styles.time}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-invalid={invalid ? true : undefined}
    >
      {ORDER.map((segment) => {
        const part = parts[segment];
        const name = NAMES[segment].toLowerCase();
        return (
          <div key={segment} className={styles.part}>
            {segment === "minute" && (
              <span className={styles.colon} aria-hidden="true">
                :
              </span>
            )}
            <div className={styles.spinner}>
              <button
                type="button"
                className={styles.step}
                tabIndex={-1}
                aria-label={`Increase ${name}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  step(segment, 1);
                  refs[segment].current?.focus();
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 10l4-4 4 4" />
                </svg>
              </button>
              <span
                ref={refs[segment]}
                className={styles.value}
                role="spinbutton"
                tabIndex={0}
                aria-label={NAMES[segment]}
                aria-valuenow={part.now}
                aria-valuemin={part.min}
                aria-valuemax={part.max}
                aria-valuetext={part.text}
                aria-invalid={invalid ? true : undefined}
                onKeyDown={(event) => {
                  onKeyDown(segment, event);
                }}
                onBlur={() => {
                  if (typed.current?.segment === segment) typed.current = null;
                }}
              >
                {part.text}
              </span>
              <button
                type="button"
                className={styles.step}
                tabIndex={-1}
                aria-label={`Decrease ${name}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  step(segment, -1);
                  refs[segment].current?.focus();
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
