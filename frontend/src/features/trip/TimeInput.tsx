import { type ChangeEvent, type KeyboardEvent, useRef, useState } from "react";

import styles from "./TimeInput.module.css";

type Segment = "hour" | "minute" | "half";
type NumberSegment = Exclude<Segment, "half">;
const ORDER: readonly Segment[] = ["hour", "minute", "half"];
const NAMES: Record<Segment, string> = { hour: "Hour", minute: "Minutes", half: "AM or PM" };
const LIMITS: Record<NumberSegment, number> = { hour: 12, minute: 59 };
// Phones and tablets: the on-screen keyboard closes whenever focus leaves a text field.
const TOUCH_QUERY = "(pointer: coarse)";

const pad = (value: number) => String(value).padStart(2, "0");
// A part being typed shows two digits, as the browser's own time input does ("5" as "05"),
// or nothing once it has been cleared.
const shownDraft = (digits: string) => (digits ? digits.padStart(2, "0") : "");

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
 * A time typed or stepped like the browser's own time input: an hour, minutes and AM or PM.
 * The hour and minutes are number fields, so a phone opens its number keypad; type digits (the
 * next part takes over once one is complete), use the up and down arrows or the buttons above
 * and below, and the left and right arrows to move. Typing is read from what the field receives
 * rather than from key presses, which phone keyboards often do not report.
 *
 * A field holds only the digits being typed and shows its value as a placeholder, so nothing is
 * ever selected: a phone shows no cut and paste bar, and the first digit typed starts afresh.
 * On a touch screen focus stays in the minutes once they are complete, and the step buttons
 * and AM or PM (a tap switches it) leave focus where it is, so the keyboard does not close and
 * open again under the finger.
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
    hour: useRef<HTMLInputElement>(null),
    minute: useRef<HTMLInputElement>(null),
    half: useRef<HTMLSpanElement>(null),
  };
  // Digits typed into a part that is not complete yet, shown as typed: "1" may become 12.
  const [draft, setDraft] = useState<{ segment: NumberSegment; digits: string } | null>(null);
  // Whether the step button or AM or PM being pressed was touched rather than clicked.
  const touchStep = useRef(false);

  const pm = hour >= 12;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const setHour12 = (value: number) => {
    onChange((value % 12) + (pm ? 12 : 0), minute);
  };

  function focus(segment: Segment | undefined) {
    setDraft(null);
    if (segment) refs[segment].current?.focus();
  }

  function step(segment: Segment, by: 1 | -1) {
    setDraft(null);
    if (segment === "hour") setHour12(((hour12 - 1 + by + 12) % 12) + 1);
    else if (segment === "minute") onChange(hour, (minute + by + 60) % 60);
    else onChange((hour + 12) % 24, minute);
  }

  function enter(segment: NumberSegment, typed: string) {
    const limit = LIMITS[segment];
    const last = typed.slice(-1);
    // Digits that cannot make a valid value start again from the last one typed.
    let digits = typed.slice(-2);
    if (Number(digits) > limit || (segment === "hour" && digits === "00")) digits = last;
    const value = Number(digits);
    if (segment === "hour") {
      if (value > 0) setHour12(value);
    } else {
      onChange(hour, value);
    }
    // Complete once two digits are in, or when no second digit could follow the first.
    const complete = digits.length === 2 || value * 10 > limit;
    if (!complete) setDraft({ segment, digits });
    // AM or PM is not a text field: moving there would close a phone's keyboard.
    else if (segment === "minute" && window.matchMedia(TOUCH_QUERY).matches) setDraft(null);
    else focus(ORDER[ORDER.indexOf(segment) + 1]);
  }

  function onInput(segment: NumberSegment, event: ChangeEvent<HTMLInputElement>) {
    // The field held nothing or the digits typed so far, so its text is all that was typed.
    const typed = event.target.value.replace(/\D/g, "");
    const shown = draft?.segment === segment ? shownDraft(draft.digits) : "";
    // Shorter than before: a digit was deleted, which clears the part to be typed again.
    if (typed && typed.length >= shown.length) enter(segment, typed);
    else setDraft({ segment, digits: "" });
  }

  function onKeyDown(segment: Segment, event: KeyboardEvent<HTMLElement>) {
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
        const shared = {
          className: styles.value,
          role: "spinbutton",
          "aria-label": NAMES[segment],
          "aria-valuenow": part.now,
          "aria-valuemin": part.min,
          "aria-valuemax": part.max,
          "aria-valuetext": part.text,
          "aria-invalid": invalid ? true : undefined,
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            onKeyDown(segment, event);
          },
        } as const;
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
                  touchStep.current = event.pointerType === "touch";
                }}
                onClick={() => {
                  step(segment, 1);
                  if (!touchStep.current) refs[segment].current?.focus();
                  touchStep.current = false;
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 10l4-4 4 4" />
                </svg>
              </button>
              {segment === "half" ? (
                <span
                  ref={refs.half}
                  tabIndex={0}
                  {...shared}
                  onPointerDown={(event) => {
                    touchStep.current = event.pointerType === "touch";
                    // A touch switches AM and PM without taking focus from the hour or minutes.
                    if (touchStep.current) event.preventDefault();
                  }}
                  onClick={() => {
                    if (touchStep.current) step("half", 1);
                    touchStep.current = false;
                  }}
                >
                  {part.text}
                </span>
              ) : (
                <input
                  ref={refs[segment]}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={3}
                  value={draft?.segment === segment ? shownDraft(draft.digits) : ""}
                  placeholder={part.text}
                  onChange={(event) => {
                    onInput(segment, event);
                  }}
                  onBlur={() => {
                    if (draft?.segment === segment) setDraft(null);
                  }}
                  {...shared}
                />
              )}
              <button
                type="button"
                className={styles.step}
                tabIndex={-1}
                aria-label={`Decrease ${name}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  touchStep.current = event.pointerType === "touch";
                }}
                onClick={() => {
                  step(segment, -1);
                  if (!touchStep.current) refs[segment].current?.focus();
                  touchStep.current = false;
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
