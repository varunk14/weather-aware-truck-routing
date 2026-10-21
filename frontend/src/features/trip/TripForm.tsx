import { useId, useRef } from "react";

import fields from "./fields.module.css";
import { PlaceInput } from "./PlaceInput";
import styles from "./TripForm.module.css";
import { type DraftErrors, type DraftField, INTERVALS, type TripDraft } from "./tripDraft";

interface TripFormProps {
  draft: TripDraft;
  errors: DraftErrors;
  busy: boolean;
  onChange: (draft: TripDraft, field: DraftField) => void;
  /** Validates and plans; returns false when the draft has errors to show. */
  onSubmit: () => boolean;
}

export function TripForm({ draft, errors, busy, onChange, onSubmit }: TripFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const departureId = `${id}-departure`;
  const loadId = `${id}-load`;
  const errorId = (field: DraftField) => `${id}-${field}-error`;

  function fieldError(field: DraftField) {
    const message = errors[field];
    return message ? (
      <p id={errorId(field)} className={fields.error}>
        {message}
      </p>
    ) : null;
  }

  return (
    <form
      ref={formRef}
      className={styles.form}
      aria-label="Plan a trip"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (!onSubmit()) {
          // Move to the first field that needs fixing once its message has rendered.
          requestAnimationFrame(() => {
            formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
          });
        }
      }}
    >
      <div className={styles.places}>
        <PlaceInput
          label="Origin"
          placeholder="City, address or place"
          value={draft.origin}
          error={errors.origin}
          onChange={(origin) => {
            onChange({ ...draft, origin }, "origin");
          }}
        />
        <button
          type="button"
          className={styles.swap}
          aria-label="Swap origin and destination"
          title="Swap origin and destination"
          onClick={() => {
            onChange({ ...draft, origin: draft.destination, destination: draft.origin }, "origin");
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 2v11M5 13l-2.5-2.5M5 13l2.5-2.5M11 14V3M11 3L8.5 5.5M11 3l2.5 2.5" />
          </svg>
        </button>
        <PlaceInput
          label="Destination"
          placeholder="City, address or place"
          value={draft.destination}
          error={errors.destination}
          onChange={(destination) => {
            onChange({ ...draft, destination }, "destination");
          }}
        />
      </div>

      <div className={fields.field}>
        <label className={fields.label} htmlFor={departureId}>
          Departure
        </label>
        <input
          id={departureId}
          className={fields.input}
          type="datetime-local"
          value={draft.departure}
          aria-invalid={errors.departure ? true : undefined}
          aria-describedby={errors.departure ? errorId("departure") : `${departureId}-hint`}
          onChange={(event) => {
            onChange({ ...draft, departure: event.target.value }, "departure");
          }}
        />
        {fieldError("departure") ?? (
          <p id={`${departureId}-hint`} className={fields.hint}>
            Your local time
          </p>
        )}
      </div>

      <div className={styles.pair}>
        <div className={fields.field}>
          <label className={fields.label} htmlFor={loadId}>
            Load weight (lb)
          </label>
          <input
            id={loadId}
            className={fields.input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="38,000"
            value={draft.load}
            aria-invalid={errors.load ? true : undefined}
            aria-describedby={errors.load ? errorId("load") : undefined}
            onChange={(event) => {
              onChange({ ...draft, load: event.target.value }, "load");
            }}
          />
          {fieldError("load")}
        </div>
        <fieldset className={styles.interval}>
          <legend className={fields.label}>Checkpoint every</legend>
          <div className={styles.segments}>
            {INTERVALS.map((miles) => (
              <label key={miles} className={styles.segment}>
                <input
                  type="radio"
                  name={`${id}-interval`}
                  value={miles}
                  checked={draft.interval === miles}
                  onChange={() => {
                    onChange({ ...draft, interval: miles }, "interval");
                  }}
                />
                <span>{miles} mi</span>
              </label>
            ))}
          </div>
          {fieldError("interval")}
        </fieldset>
      </div>

      {errors.form && (
        <p className={styles.formError} role="alert">
          {errors.form}
        </p>
      )}

      {/* aria-disabled rather than disabled, so the button keeps the keyboard focus. */}
      <button type="submit" className={styles.submit} aria-disabled={busy}>
        {busy ? "Planning routes…" : "Plan routes"}
      </button>
    </form>
  );
}
