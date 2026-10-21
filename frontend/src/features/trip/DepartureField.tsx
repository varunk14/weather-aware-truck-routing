import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { toDatetimeLocal } from "../../lib/format";
import styles from "./DepartureField.module.css";
import fields from "./fields.module.css";
import { departureBounds } from "./tripDraft";

const MINUTES = [0, 15, 30, 45];
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const STEP_MS = 15 * 60 * 1000;

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
// 18 October 2026 is a Sunday: weekday headings start on Sunday, as on US calendars.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => WEEKDAY.format(new Date(2026, 9, 18 + i)));

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const firstOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
const dayKey = (date: Date) => toDatetimeLocal(date).slice(0, 10);
const to24 = (hour12: number, half: "am" | "pm") => (hour12 % 12) + (half === "pm" ? 12 : 0);

interface Pending {
  day: Date;
  hour: number;
  minute: number;
}

function compose({ day, hour, minute }: Pending): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

/** The pending choice moved into the allowed window, on 15 minute steps. */
function clamp(pending: Pending, earliest: Date, latest: Date): Pending {
  const moment = compose(pending);
  let fixed: Date | null = null;
  if (moment < earliest) fixed = new Date(Math.ceil(earliest.getTime() / STEP_MS) * STEP_MS);
  if (moment > latest) fixed = new Date(Math.floor(latest.getTime() / STEP_MS) * STEP_MS);
  return fixed
    ? { day: startOfDay(fixed), hour: fixed.getHours(), minute: fixed.getMinutes() }
    : pending;
}

interface DepartureFieldProps {
  /** A datetime-local value in the browser's time zone, for example "2026-10-24T19:00". */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  now?: Date;
}

/**
 * The departure, picked from a calendar of the allowed days (now to seven days ahead) and a
 * time in 15 minute steps. Nothing changes until Done; Cancel, Escape or a click outside keep
 * the departure as it was.
 */
export function DepartureField({ value, onChange, error, now = new Date() }: DepartureFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const noteId = `${id}-note`;
  const dialogId = `${id}-dialog`;
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
    const base = shown ?? earliest;
    const next = clamp(
      {
        day: startOfDay(base),
        hour: base.getHours(),
        minute: base.getMinutes() - (base.getMinutes() % 15),
      },
      earliest,
      latest,
    );
    setPending(next);
    setMonth(firstOfMonth(next.day));
  }

  function close(apply: boolean) {
    if (apply && pending) onChange(toDatetimeLocal(compose(pending)));
    setPending(null);
    triggerRef.current?.focus();
  }

  function update(change: Partial<Pending>) {
    if (!pending) return;
    const next = clamp({ ...pending, ...change }, earliest, latest);
    setPending(next);
    setMonth(firstOfMonth(next.day));
  }

  // Focus the chosen day when the calendar opens, and when the keyboard moves the choice.
  const pendingKey = pending ? dayKey(pending.day) : null;
  useEffect(() => {
    if (!pendingKey) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${pendingKey}"]`)?.focus();
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
    if (day >= firstDay && day <= lastDay) update({ day });
  }

  const valid = (change: Partial<Pending>) => {
    if (!pending) return false;
    const moment = compose({ ...pending, ...change });
    return moment >= earliest && moment <= latest;
  };
  const meridiem = pending && pending.hour >= 12 ? "pm" : "am";

  const monthStart = firstOfMonth(month);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: monthStart.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i)),
  ];
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  return (
    <div ref={fieldRef} className={[fields.field, styles.field].join(" ")}>
      <span id={labelId} className={fields.label}>
        Departure
      </span>
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
      {error ? (
        <p id={noteId} className={fields.error}>
          {error}
        </p>
      ) : (
        <p id={noteId} className={fields.hint}>
          Your local time
        </p>
      )}

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
          <div className={styles.header}>
            <p className={styles.month} aria-live="polite">
              {MONTH.format(month)}
            </p>
            <button
              type="button"
              className={styles.step}
              aria-label="Previous month"
              disabled={firstDay >= monthStart}
              onClick={() => {
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.step}
              aria-label="Next month"
              disabled={nextMonth > lastDay}
              onClick={() => {
                setMonth(nextMonth);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3l5 5-5 5" />
              </svg>
            </button>
          </div>

          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((name, index) => (
              <span key={index}>{name}</span>
            ))}
          </div>
          <div ref={gridRef} className={styles.days} onKeyDown={onDaysKeyDown}>
            {cells.map((day, index) =>
              day ? (
                <button
                  key={dayKey(day)}
                  type="button"
                  className={styles.day}
                  data-day={dayKey(day)}
                  data-today={sameDay(day, now) || undefined}
                  aria-label={FULL_DAY.format(day)}
                  aria-pressed={sameDay(day, pending.day)}
                  tabIndex={sameDay(day, pending.day) ? 0 : -1}
                  disabled={day < firstDay || day > lastDay}
                  onClick={() => {
                    update({ day });
                  }}
                >
                  {day.getDate()}
                </button>
              ) : (
                <span key={`blank-${String(index)}`} />
              ),
            )}
          </div>

          <div className={styles.time}>
            <span className={styles.timeLabel}>Time</span>
            <select
              className={[fields.input, styles.select].join(" ")}
              aria-label="Hour"
              value={pending.hour % 12 === 0 ? 12 : pending.hour % 12}
              onChange={(event) => {
                update({ hour: to24(Number(event.target.value), meridiem) });
              }}
            >
              {HOURS.map((hour) => (
                <option
                  key={hour}
                  value={hour}
                  disabled={
                    !MINUTES.some((minute) => valid({ hour: to24(hour, meridiem), minute }))
                  }
                >
                  {hour}
                </option>
              ))}
            </select>
            <span aria-hidden="true">:</span>
            <select
              className={[fields.input, styles.select].join(" ")}
              aria-label="Minutes"
              value={pending.minute}
              onChange={(event) => {
                update({ minute: Number(event.target.value) });
              }}
            >
              {MINUTES.map((minute) => (
                <option key={minute} value={minute} disabled={!valid({ minute })}>
                  {String(minute).padStart(2, "0")}
                </option>
              ))}
            </select>
            <div className={styles.meridiem} role="group" aria-label="AM or PM">
              {(["am", "pm"] as const).map((half) => (
                <button
                  key={half}
                  type="button"
                  aria-pressed={meridiem === half}
                  disabled={
                    !HOURS.some((hour) =>
                      MINUTES.some((minute) => valid({ hour: to24(hour, half), minute })),
                    )
                  }
                  onClick={() => {
                    update({ hour: (pending.hour % 12) + (half === "pm" ? 12 : 0) });
                  }}
                >
                  {half.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

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
              onClick={() => {
                close(true);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
