import { useId } from "react";

import fields from "./fields.module.css";
import { departureWindow } from "./tripDraft";

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
 * The browser's date and time picker, limited to the days a departure is allowed on. The
 * departure is spelled out under the field, so a change is visible as soon as it is made.
 */
export function DepartureField({ value, onChange, error, now = new Date() }: DepartureFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const { min, max } = departureWindow(now);
  const chosen = value ? new Date(value) : null;
  const valid = chosen !== null && !Number.isNaN(chosen.getTime());

  return (
    <div className={fields.field}>
      <label className={fields.label} htmlFor={id}>
        Departure
      </label>
      <input
        id={id}
        className={fields.input}
        type="datetime-local"
        value={value}
        min={min}
        max={max}
        aria-invalid={error ? true : undefined}
        aria-describedby={noteId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error ? (
        <p id={noteId} className={fields.error}>
          {error}
        </p>
      ) : (
        <p id={noteId} className={fields.hint}>
          {valid ? `Leaves ${SUMMARY.format(chosen)} (your local time)` : "Your local time"}
        </p>
      )}
    </div>
  );
}
