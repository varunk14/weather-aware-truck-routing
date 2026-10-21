/**
 * The trip form's values, their validation and their conversion into an API request.
 * The rules mirror the API's, so most mistakes are caught before a request is sent; the API
 * still validates everything and its messages are shown on the same fields.
 */

import { nextWholeHour, toDatetimeLocal } from "../../lib/format";
import type { Interval, LocationInput, TripRequest } from "../../lib/types";

export const INTERVALS: readonly Interval[] = [10, 25, 50];
export const MAX_LOAD_LB = 80_000;
export const MAX_DAYS_AHEAD = 7;
const DEPARTURE_GRACE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the user typed, plus the suggestion they picked for it, if any. */
export interface PlaceValue {
  text: string;
  picked?: { id: string; type: string };
}

export interface TripDraft {
  origin: PlaceValue;
  destination: PlaceValue;
  /** The value of a datetime-local input, in the browser's time zone. */
  departure: string;
  /** As typed; may contain thousands separators. */
  load: string;
  interval: Interval;
}

export type DraftField = "origin" | "destination" | "departure" | "load" | "interval" | "form";

export type DraftErrors = Partial<Record<DraftField, string>>;

/** API request fields mapped to the form field that shows their errors. */
const API_FIELDS: Record<string, DraftField> = {
  origin: "origin",
  destination: "destination",
  departure: "departure",
  load_lb: "load",
  interval_mi: "interval",
  non_field_errors: "form",
};

export function emptyDraft(now: Date): TripDraft {
  return {
    origin: { text: "" },
    destination: { text: "" },
    departure: toDatetimeLocal(nextWholeHour(now)),
    load: "",
    interval: 25,
  };
}

export function parseLoad(load: string): number | undefined {
  const digits = load.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(digits)) return undefined;
  return Number(digits);
}

export function validateDraft(draft: TripDraft, now: Date): DraftErrors {
  const errors: DraftErrors = {};

  if (!draft.origin.text.trim()) errors.origin = "Enter where the trip starts.";
  if (!draft.destination.text.trim()) errors.destination = "Enter where the trip ends.";
  if (!errors.origin && !errors.destination && samePlace(draft.origin, draft.destination)) {
    errors.destination = "The origin and destination are the same place.";
  }

  const departure = new Date(draft.departure);
  if (!draft.departure || Number.isNaN(departure.getTime())) {
    errors.departure = "Enter a departure date and time.";
  } else if (departure.getTime() < now.getTime() - DEPARTURE_GRACE_MS) {
    errors.departure = "Departure must be now or later.";
  } else if (departure.getTime() > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) {
    errors.departure = `Departure must be within the next ${String(MAX_DAYS_AHEAD)} days.`;
  }

  const load = parseLoad(draft.load);
  if (load === undefined || load < 1 || load > MAX_LOAD_LB) {
    errors.load = "Enter the load in whole pounds, from 1 to 80,000.";
  }

  return errors;
}

function samePlace(a: PlaceValue, b: PlaceValue): boolean {
  if (a.picked && b.picked) return a.picked.id === b.picked.id;
  return a.text.trim().toLowerCase() === b.text.trim().toLowerCase();
}

function toLocation(place: PlaceValue): LocationInput {
  return place.picked
    ? { place_id: place.picked.id, place_type: place.picked.type }
    : { query: place.text.trim() };
}

/** The API request for a draft that passed ``validateDraft``. */
export function toTripRequest(draft: TripDraft): TripRequest {
  return {
    origin: toLocation(draft.origin),
    destination: toLocation(draft.destination),
    departure: new Date(draft.departure).toISOString(),
    load_lb: parseLoad(draft.load) ?? 0,
    interval_mi: draft.interval,
  };
}

/** The API's 400 field errors, keyed by the form field that shows them. */
export function apiFieldErrors(fieldErrors: Readonly<Record<string, string>>): DraftErrors {
  const errors: DraftErrors = {};
  for (const [field, message] of Object.entries(fieldErrors)) {
    errors[API_FIELDS[field] ?? "form"] ??= message;
  }
  return errors;
}
