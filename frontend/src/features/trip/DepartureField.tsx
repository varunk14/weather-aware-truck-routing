import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { toDatetimeLocal } from "../../lib/format";
import styles from "./DepartureField.module.css";
import fields from "./fields.module.css";
import { TimeInput } from "./TimeInput";
import { beyondReliableForecast, departureBounds, MAX_DAYS_AHEAD } from "./tripDraft";

const MINUTE_MS = 60 * 1000;
const CALENDAR_DAYS = 42; // Six weeks, so the calendar keeps its height from month to month.

const SHOWN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const FULL_DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
// 18 October 2026 is a Sunday: weeks start on Sunday, as on US calendars.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => WEEKDAY.format(new Date(2026, 9, 18 + i)));

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const firstOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, months: number) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
const dayKey = (date: Date) => toDatetimeLocal(date).slice(0, 10);

interface Pending {
  day: Date;
  hour: number;
  minute: number;
}

function compose({ day, hour, minute }: Pending): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

/** A moment moved into the allowed window, to the whole minute. */
function clamp(moment: Date, earliest: Date, latest: Date): Pending {
  let fixed = moment;
  if (moment < earliest) fixed = new Date(Math.ceil(earliest.getTime() / MINUTE_MS) * MINUTE_MS);
  if (moment > latest) fixed = new Date(Math.floor(latest.getTime() / MINUTE_MS) * MINUTE_MS);
  return { day: startOfDay(fixed), hour: fixed.getHours(), minute: fixed.getMinutes() };
}

interface DepartureFieldProps {
  /** A datetime-local value in the browser's time zone, for example "2026-10-24T19:00". */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  now?: Date;
}

/**
 * The departure, picked like the browser's own date and time picker: a month calendar in which
 * only the allowed days (now to ten days ahead) can be chosen, and a time that is typed or
 * stepped up and down. Nothing changes until Done; Cancel, Escape or a click outside keep the
 * departure as it was.
 */
export function DepartureField({ value, onChange, error, now = new Date() }: DepartureFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const noteId = `${id}-note`;
  const dialogId = `${id}-dialog`;
  const timeLabelId = `${id}-time`;
  const problemId = `${id}-problem`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { earliest, latest } = departureBounds(now);
  const firstDay = startOfDay(earliest);
  const lastDay = startOfDay(latest);

  const current = value ? new Date(value) : null;
  const shown = current && !Number.isNaN(current.getTime()) ? current : null;
  const [pending, setPending] = useState<Pending | null>(null);
  const [month, setMonth] = useState(() => firstOfMonth(firstDay));

  function begin() {
    const next = clamp(shown ?? earliest, earliest, latest);
    setPending(next);
    setMonth(firstOfMonth(next.day));
  }

  function close(apply: boolean) {
    if (apply && pending) onChange(toDatetimeLocal(compose(pending)));
    setPending(null);
    triggerRef.current?.focus();
  }

  function pickDay(day: Date) {
    if (!pending) return;
    setPending({ ...pending, day });
    setMonth(firstOfMonth(day));
  }

  // Focus the chosen day when the calendar opens, and when the keyboard moves the choice.
  const pendingKey = pending ? dayKey(pending.day) : null;
  useEffect(() => {
    const grid = gridRef.current;
    if (!pendingKey || !grid) return;
    // On open the focus is still on the trigger; after that only a day passes it to a day.
    const focused = document.activeElement;
    if (grid.closest('[role="dialog"]')?.contains(focused) && !grid.contains(focused)) return;
    grid.querySelector<HTMLButtonElement>(`[data-day="${pendingKey}"]`)?.focus();
  }, [pendingKey]);

  // A press outside the field cancels, like Escape.
  const open = pending !== null;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setPending(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const allowed = (day: Date) => day >= firstDay && day <= lastDay;

  function onDaysKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const by = moves[event.key];
    if (!pending || by === undefined) return;
    event.preventDefault();
    const day = addDays(pending.day, by);
    if (allowed(day)) pickDay(day);
  }

  // A typed time can fall outside the window; Done waits until it is fixed.
  const moment = pending ? compose(pending) : null;
  let problem: string | null = null;
  if (moment && moment < earliest) problem = "That time has already passed.";
  if (moment && moment > latest) {
    problem = `That is more than ${String(MAX_DAYS_AHEAD)} days ahead.`;
  }

  const gridStart = addDays(month, -month.getDay());
  const days = Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(gridStart, i));
  // The day the Tab key reaches in the grid: the chosen one, or else the first allowed one shown.
  const tabDay =
    pending && days.some((day) => sameDay(day, pending.day)) ? pending.day : days.find(allowed);

  const farAhead = shown !== null && beyondReliableForecast(shown, now);

  return (
    <div
      ref={fieldRef}
      className={[fields.field, styles.field].join(" ")}
      data-open={open || undefined}
    >
      <span id={labelId} className={fields.label}>
        Departure
      </span>
      <div className={styles.anchor}>
        <button
          ref={triggerRef}
          type="button"
          className={[fields.input, styles.trigger].join(" ")}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-describedby={noteId}
          aria-invalid={error ? true : undefined}
          onClick={() => {
            if (open) close(false);
            else begin();
          }}
        >
          <span id={valueId}>{shown ? SHOWN.format(shown) : "Choose a departure"}</span>
          <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="2" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          </svg>
        </button>

        {pending && (
          <div
            id={dialogId}
            className={styles.popover}
            role="dialog"
            aria-label="Choose the departure"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close(false);
              }
            }}
          >
            <section className={styles.calendar} aria-label="Day">
              <div className={styles.header}>
                <p className={styles.month} aria-live="polite">
                  {MONTH.format(month)}
                </p>
                <button
                  type="button"
                  className={styles.step}
                  aria-label="Previous month"
                  disabled={month <= firstOfMonth(firstDay)}
                  onClick={() => {
                    setMonth(addMonths(month, -1));
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M10 3.5 5.5 8l4.5 4.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.step}
                  aria-label="Next month"
                  disabled={addMonths(month, 1) > lastDay}
                  onClick={() => {
                    setMonth(addMonths(month, 1));
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 3.5 10.5 8 6 12.5" />
                  </svg>
                </button>
              </div>
              <div className={styles.weekdays} aria-hidden="true">
                {WEEKDAYS.map((weekday, index) => (
                  <span key={index}>{weekday}</span>
                ))}
              </div>
              <div ref={gridRef} className={styles.days} onKeyDown={onDaysKeyDown}>
                {days.map((day) => (
                  <button
                    key={dayKey(day)}
                    type="button"
                    className={styles.day}
                    data-day={dayKey(day)}
                    data-today={sameDay(day, now) || undefined}
                    data-outside={day.getMonth() !== month.getMonth() || undefined}
                    aria-label={FULL_DAY.format(day)}
                    aria-pressed={sameDay(day, pending.day)}
                    tabIndex={tabDay && sameDay(day, tabDay) ? 0 : -1}
                    disabled={!allowed(day)}
                    onClick={() => {
                      pickDay(day);
                    }}
                  >
                    {day.getDate()}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.time} aria-labelledby={timeLabelId}>
              <p id={timeLabelId} className={styles.timeLabel}>
                Time
              </p>
              <TimeInput
                hour={pending.hour}
                minute={pending.minute}
                labelledBy={timeLabelId}
                describedBy={problem ? problemId : undefined}
                invalid={problem !== null}
                onChange={(hour, minute) => {
                  setPending({ ...pending, hour, minute });
                }}
              />
            </section>
            {problem && (
              <p id={problemId} className={styles.problem} role="alert">
                {problem}
              </p>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancel}
                onClick={() => {
                  close(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.done}
                aria-disabled={problem ? true : undefined}
                onClick={() => {
                  if (!problem) close(true);
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
      {error ? (
        <p id={noteId} className={[fields.error, styles.note].join(" ")}>
          {error}
        </p>
      ) : (
        <p id={noteId} className={[fields.hint, styles.note].join(" ")}>
          {farAhead
            ? "Your local time. Forecasts more than a week ahead are less certain."
            : "Your local time"}
        </p>
      )}
    </div>
  );
}
