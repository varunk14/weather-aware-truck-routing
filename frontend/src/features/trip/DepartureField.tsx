import { useId } from "react";

import styles from "./DepartureField.module.css";
import fields from "./fields.module.css";
import { atTime, departureDays, departureTimes } from "./tripDraft";

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const SUMMARY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface DepartureFieldProps {
  /** A datetime-local value in the browser's time zone, for example "2026-10-24T19:00". */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  now?: Date;
}

/**
 * The departure as a day and a time. Departures are allowed from now to seven days ahead, so
 * the days are buttons and the times a list; every choice applies at once and stays visible.
 */
export function DepartureField({ value, onChange, error, now = new Date() }: DepartureFieldProps) {
  const id = useId();
  const timeId = `${id}-time`;
  const summaryId = `${id}-summary`;
  const errorId = `${id}-error`;
  const days = departureDays(now);
  const selected = Math.max(
    days.findIndex((day) => day.key === value.slice(0, 10)),
    0,
  );
  const day = days[selected];
  const time = value.slice(11, 16);
  const times = day ? departureTimes(day.date, now) : [];
  // A time no longer offered (the clock has moved on) stays visible until it is changed.
  const options = !time || times.includes(time) ? times : [time, ...times];

  function pickDay(index: number) {
    const next = days[index];
    if (!next) return;
    const available = departureTimes(next.date, now);
    const kept = available.includes(time) ? time : (available[0] ?? time);
    onChange(`${next.key}T${kept}`);
  }

  const chosen = day && time ? atTime(day.date, time) : null;

  return (
    <fieldset className={styles.departure}>
      <legend className={fields.label}>Departure (your local time)</legend>
      <div className={styles.days}>
        {days.map((option, index) => (
          <label key={option.key} className={styles.day}>
            <input
              type="radio"
              name={`${id}-day`}
              value={option.key}
              checked={index === selected}
              onChange={() => {
                pickDay(index);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className={styles.timeRow}>
        <label className="visually-hidden" htmlFor={timeId}>
          Departure time
        </label>
        <select
          id={timeId}
          className={[fields.input, styles.time].join(" ")}
          value={time}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : summaryId}
          onChange={(event) => {
            if (day) onChange(`${day.key}T${event.target.value}`);
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {day ? CLOCK.format(atTime(day.date, option)) : option}
            </option>
          ))}
        </select>
        {chosen && (
          <p id={summaryId} className={styles.summary}>
            Leaves {SUMMARY.format(chosen)}
          </p>
        )}
      </div>
      {error && (
        <p id={errorId} className={fields.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
