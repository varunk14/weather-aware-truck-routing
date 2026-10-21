import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, isAbortError, planTrip } from "../../lib/api";
import type { TripPlan, TripRequest } from "../../lib/types";
import {
  apiFieldErrors,
  type DraftErrors,
  type DraftField,
  emptyDraft,
  toTripRequest,
  type TripDraft,
  validateDraft,
} from "./tripDraft";

export type PlanStatus = "idle" | "loading" | "success" | "error";

export interface PlanState {
  status: PlanStatus;
  /** The plan on screen: the last one that arrived, kept while a new one loads. */
  plan: TripPlan | null;
  error: ApiError | null;
  /** When the current request started (ms since epoch), while loading. */
  startedAt: number | null;
  /** While loading: the state to go back to if the request is cancelled. */
  previous: PlanState | null;
  /** The trip this state belongs to, so "Try again" repeats the right one. */
  trip: TripRequest | null;
}

const IDLE: PlanState = {
  status: "idle",
  plan: null,
  error: null,
  startedAt: null,
  previous: null,
  trip: null,
};

/** Editing a place clears both place errors: "same place" is reported on the destination. */
function clearErrors(errors: DraftErrors, field: DraftField): DraftErrors {
  const cleared = new Set<string>(
    field === "origin" || field === "destination"
      ? ["origin", "destination", "form"]
      : [field, "form"],
  );
  return Object.fromEntries(Object.entries(errors).filter(([name]) => !cleared.has(name)));
}

export function useTripPlanner() {
  const [draft, setDraft] = useState<TripDraft>(() => emptyDraft(new Date()));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [state, setState] = useState<PlanState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const run = useCallback((trip: TripRequest) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((current) => ({
      ...current,
      status: "loading",
      error: null,
      startedAt: Date.now(),
      previous: current.status === "loading" ? current.previous : current,
      trip,
    }));

    planTrip(trip, controller.signal).then(
      (plan) => {
        if (controllerRef.current !== controller) return;
        controllerRef.current = null;
        setState({ ...IDLE, status: "success", plan, trip });
      },
      (reason: unknown) => {
        if (isAbortError(reason) || controllerRef.current !== controller) return;
        controllerRef.current = null;
        const error =
          reason instanceof ApiError
            ? reason
            : new ApiError("Something went wrong while planning the trip. Try again.", 0);
        if (error.status === 400) {
          const fields = apiFieldErrors(error.fieldErrors);
          // A 400 that names no field still needs a message on the form.
          setErrors(Object.keys(fields).length > 0 ? fields : { form: error.message });
        }
        setState({ ...IDLE, status: "error", error, trip });
      },
    );
  }, []);

  const change = useCallback((next: TripDraft, field: DraftField) => {
    setDraft(next);
    setErrors((current) => clearErrors(current, field));
  }, []);

  /** Validates the draft and plans it; returns false when there are errors to fix first. */
  const submit = useCallback((): boolean => {
    const found = validateDraft(draft, new Date());
    setErrors(found);
    if (Object.keys(found).length > 0) return false;
    run(toTripRequest(draft));
    return true;
  }, [draft, run]);

  const retry = useCallback(() => {
    if (state.trip) run(state.trip);
  }, [run, state.trip]);

  /** Stops the request and goes back to what was on screen before it. */
  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    controllerRef.current.abort();
    controllerRef.current = null;
    setState((current) => current.previous ?? IDLE);
  }, []);

  return { draft, errors, state, change, submit, retry, cancel };
}
