import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { toDatetimeLocal } from "../../lib/format";
import styles from "./DepartureField.module.css";
import fields from "./fields.module.css";
import { departureBounds } from "./tripDraft";

const MINUTES = [0, 15, 30, 45] as const;
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const HALVES = ["am", "pm"] as const;
const STEP_MS = 15 * 60 * 1000;
const HOUR_COLUMNS = 6;

type Half = (typeof HALVES)[number];

const SHOWN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const SHORT_MONTH = new Intl.DateTimeFormat(undefined, { month: "short" });
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
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
const dayKey = (date: Date) => toDatetimeLocal(date).slice(0, 10);
const to24 = (hour12: number, half: Half) => (hour12 % 12) + (half === "pm" ? 12 : 0);
const pad = (minute: number) => String(minute).padStart(2, "0");

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

interface ChoiceProps<T extends string | number> {
  label: string;
  options: readonly T[];
  value: T;
  columns: number;
  className: string | undefined;
  text: (option: T) => string;
  name: (option: T) => string;
  enabled: (option: T) => boolean;
  onChange: (option: T) => void;
}

/**
 * One choice from a few, as a group of radio buttons laid out in a grid. Only the chosen one is
 * in the tab order; the arrow keys move the choice, skipping the ones that are not allowed.
 */
function Choice<T extends string | number>({
  label,
  options,
  value,
  columns,
  className,
  text,
  name,
  enabled,
  onChange,
}: ChoiceProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  // Keep the focus on the choice when the keyboard moves it.
  useEffect(() => {
    const group = groupRef.current;
    if (!group?.contains(document.activeElement)) return;
    group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    const by = moves[event.key];
    if (by === undefined) return;
    event.preventDefault();
    let index = options.indexOf(value) + by;
    while (index >= 0 && index < options.length) {
      const option = options[index];
      if (option !== undefined && enabled(option)) {
        onChange(option);
        return;
      }
      // A step to the side keeps looking past options that are not allowed; up or down does not.
      if (Math.abs(by) !== 1) return;
      index += by;
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={className}
      style={{ gridTemplateColumns: `repeat(${String(columns)}, 1fr)` }}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          className={styles.chip}
          aria-checked={option === value}
          aria-label={name(option)}
          tabIndex={option === value ? 0 : -1}
          disabled={!enabled(option)}
          onClick={() => {
            onChange(option);
          }}
        >
          {text(option)}
        </button>
      ))}
    </div>
  );
}

interface DepartureFieldProps {
  /** A datetime-local value in the browser's time zone, for example "2026-10-24T19:00". */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  now?: Date;
}

/**
 * The departure, picked from the two weeks that hold the allowed days (now to seven days ahead)
 * and a time in 15 minute steps. Nothing changes until Done; Cancel, Escape or a click outside
 * keep the departure as it was.
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

  function begin() {
    const base = shown ?? earliest;
    setPending(
      clamp(
        {
          day: startOfDay(base),
          hour: base.getHours(),
          minute: base.getMinutes() - (base.getMinutes() % 15),
        },
        earliest,
        latest,
      ),
    );
  }

  function close(apply: boolean) {
    if (apply && pending) onChange(toDatetimeLocal(compose(pending)));
    setPending(null);
    triggerRef.current?.focus();
  }

  function update(change: Partial<Pending>) {
    if (pending) setPending(clamp({ ...pending, ...change }, earliest, latest));
  }

  // Focus the chosen day when the calendar opens, and when the keyboard moves the choice.
  const pendingKey = pending ? dayKey(pending.day) : null;
  useEffect(() => {
    const grid = gridRef.current;
    if (!pendingKey || !grid) return;
    // On open the focus is still on the trigger. After that a day only takes the focus from
    // another day: a time that moves the choice to another day leaves the focus on the time.
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
  const half: Half = pending && pending.hour >= 12 ? "pm" : "am";
  const hourAllowed = (hour: number, inHalf: Half) =>
    MINUTES.some((minute) => valid({ hour: to24(hour, inHalf), minute }));

  // The allowed days always fit in two weeks: eight days, starting on any weekday.
  const weekStart = addDays(firstDay, -firstDay.getDay());
  const days = Array.from({ length: 14 }, (_, i) => addDays(weekStart, i));
  const spansMonths = firstDay.getMonth() !== lastDay.getMonth();
  const title = spansMonths ? MONTH.formatRange(firstDay, lastDay) : MONTH.format(firstDay);

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
            <section className={styles.section} aria-label="Day">
              <p className={styles.title}>{title}</p>
              <div className={styles.weekdays} aria-hidden="true">
                {WEEKDAYS.map((weekday, index) => (
                  <span key={index}>{weekday}</span>
                ))}
              </div>
              <div ref={gridRef} className={styles.days} onKeyDown={onDaysKeyDown}>
                {days.map((day) => {
                  const chosen = sameDay(day, pending.day);
                  return (
                    <button
                      key={dayKey(day)}
                      type="button"
                      className={styles.day}
                      data-day={dayKey(day)}
                      data-today={sameDay(day, now) || undefined}
                      aria-label={FULL_DAY.format(day)}
                      aria-pressed={chosen}
                      tabIndex={chosen ? 0 : -1}
                      disabled={day < firstDay || day > lastDay}
                      onClick={() => {
                        update({ day });
                      }}
                    >
                      {spansMonths && day.getDate() === 1 && (
                        <span className={styles.monthTag} aria-hidden="true">
                          {SHORT_MONTH.format(day)}
                        </span>
                      )}
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.section} aria-label="Time">
              <div className={styles.timeHeader}>
                <p className={styles.title}>Time</p>
                <Choice
                  label="AM or PM"
                  options={HALVES}
                  value={half}
                  columns={2}
                  className={styles.segments}
                  text={(option) => option.toUpperCase()}
                  name={(option) => option.toUpperCase()}
                  enabled={(option) => HOURS.some((hour) => hourAllowed(hour, option))}
                  onChange={(option) => {
                    update({ hour: (pending.hour % 12) + (option === "pm" ? 12 : 0) });
                  }}
                />
              </div>
              <Choice
                label="Hour"
                options={HOURS}
                value={pending.hour % 12 === 0 ? 12 : pending.hour % 12}
                columns={HOUR_COLUMNS}
                className={styles.chips}
                text={String}
                name={(hour) => `${String(hour)} ${half.toUpperCase()}`}
                enabled={(hour) => hourAllowed(hour, half)}
                onChange={(hour) => {
                  update({ hour: to24(hour, half) });
                }}
              />
              <Choice
                label="Minutes"
                options={MINUTES}
                value={pending.minute as (typeof MINUTES)[number]}
                columns={MINUTES.length}
                className={styles.chips}
                text={(minute) => `:${pad(minute)}`}
                name={(minute) => `${pad(minute)} minutes`}
                enabled={(minute) => valid({ minute })}
                onChange={(minute) => {
                  update({ minute });
                }}
              />
            </section>

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
      {error ? (
        <p id={noteId} className={[fields.error, styles.note].join(" ")}>
          {error}
        </p>
      ) : (
        <p id={noteId} className={[fields.hint, styles.note].join(" ")}>
          Your local time
        </p>
      )}
    </div>
  );
}
