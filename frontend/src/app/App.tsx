import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";

import { AppHeader } from "../components/AppHeader/AppHeader";
import { Attribution } from "../components/Attribution/Attribution";
import { BottomSheet, type SheetSnap } from "../components/BottomSheet/BottomSheet";
import { EmptyState } from "../components/EmptyState/EmptyState";
import type { MapPadding } from "../features/map/MapView";
import { CheckpointDetails } from "../features/results/CheckpointDetails";
import { ErrorState, LoadingState } from "../features/results/PlanStatus";
import { Recommendation } from "../features/results/Recommendation";
import { TripResults } from "../features/results/TripResults";
import { TripSummary } from "../features/results/TripSummary";
import { TripForm } from "../features/trip/TripForm";
import { useTripPlanner } from "../features/trip/useTripPlanner";
import { useApiStatus } from "../hooks/useApiStatus";
import { PHONE_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { routeById } from "../lib/plan";
import type { TripPlan } from "../lib/types";
import styles from "./App.module.css";

// MapLibre is the largest dependency; loading it separately keeps the first paint fast.
const MapView = lazy(() => import("../features/map/MapView"));

/** What the phone's bottom sheet shows, and where it sits for each. */
type SheetView = "form" | "loading" | "error" | "results";
const SHEET_START: Record<SheetView, SheetSnap> = {
  form: "full",
  loading: "peek",
  error: "peek",
  results: "peek",
};

const DESKTOP_PADDING: MapPadding = { top: 48, right: 48, bottom: 48, left: 48 };
// Room around routes on a phone, so end markers and their labels stay on screen.
const PHONE_EDGE = 32;

interface Selection {
  plan: TripPlan | null;
  routeId: string | null;
  checkpoint: number | null;
}

export function App() {
  const apiStatus = useApiStatus();
  const phone = useMediaQuery(PHONE_QUERY);
  const { draft, errors, state, change, submit, retry, cancel } = useTripPlanner();
  const plan = state.status === "success" ? state.plan : null;
  const failed = state.status === "error" && state.error?.status !== 400 ? state.error : null;
  const [editing, setEditing] = useState(false);

  // The selection belongs to one plan; a new plan starts from its recommended route.
  const [selection, setSelection] = useState<Selection>({
    plan: null,
    routeId: null,
    checkpoint: null,
  });
  const current: Selection =
    plan && selection.plan === plan
      ? selection
      : { plan, routeId: plan?.recommendation.route_id ?? null, checkpoint: null };
  const route = plan ? routeById(plan, current.routeId) : undefined;

  let view: SheetView = "form";
  if (state.status === "loading") view = "loading";
  else if (failed && !editing) view = "error";
  else if (plan && !editing) view = "results";

  // Each view opens at its own position; the user can move the sheet from there.
  const [sheet, setSheet] = useState<{ view: SheetView; snap: SheetSnap }>({
    view: "form",
    snap: "full",
  });
  const snap = sheet.view === view ? sheet.snap : SHEET_START[view];
  const [sheetHeight, setSheetHeight] = useState(0);

  const padding = useMemo<MapPadding>(
    () =>
      phone
        ? {
            top: PHONE_EDGE,
            right: PHONE_EDGE,
            bottom: sheetHeight + PHONE_EDGE,
            left: PHONE_EDGE,
          }
        : DESKTOP_PADDING,
    [phone, sheetHeight],
  );

  function onSubmit(): boolean {
    const valid = submit();
    if (valid) setEditing(false);
    return valid;
  }

  function selectRoute(routeId: string) {
    setSelection({ plan, routeId, checkpoint: null });
    if (phone) setSheet({ view, snap: "peek" });
  }

  function selectCheckpoint(checkpoint: number) {
    setSelection({ ...current, checkpoint });
    if (phone) setSheet({ view, snap: "peek" });
  }

  const form = (
    <TripForm
      draft={draft}
      errors={errors}
      busy={state.status === "loading"}
      onChange={change}
      onSubmit={onSubmit}
    />
  );

  const results = plan && current.routeId && (
    <TripResults
      plan={plan}
      selectedRouteId={current.routeId}
      selectedCheckpoint={current.checkpoint}
      onSelectRoute={selectRoute}
      onSelectCheckpoint={selectCheckpoint}
      showRecommendation={!phone}
    />
  );

  const loading = state.status === "loading" && state.startedAt !== null && (
    <LoadingState startedAt={state.startedAt} onCancel={cancel} />
  );

  const details = plan && route && current.checkpoint !== null && (
    <div className={styles.details}>
      <CheckpointDetails
        route={route}
        index={current.checkpoint}
        loadLb={plan.load_lb}
        onClose={() => {
          setSelection({ ...current, checkpoint: null });
        }}
      />
    </div>
  );

  const map = (
    <Suspense fallback={<div className={styles.mapLoading} aria-hidden="true" />}>
      <MapView
        plan={plan}
        selectedRouteId={current.routeId}
        selectedCheckpoint={current.checkpoint}
        padding={padding}
        onSelectRoute={selectRoute}
        onSelectCheckpoint={selectCheckpoint}
      />
    </Suspense>
  );

  if (!phone) {
    return (
      <main className={styles.app}>
        <div className={styles.header}>
          <AppHeader apiStatus={apiStatus} />
        </div>
        <section className={styles.panel} aria-label="Trip planner">
          {form}
          {loading}
          {failed && <ErrorState error={failed} onRetry={retry} />}
          {results}
          {state.status === "idle" && <EmptyState />}
          <Attribution />
        </section>
        <div className={styles.mapArea}>
          {map}
          {details}
        </div>
      </main>
    );
  }

  const sheetContent: Record<SheetView, { peek: ReactNode; body: ReactNode }> = {
    form: {
      peek: (
        <div className={styles.sheetTitle}>
          <h2>Plan a trip</h2>
          {plan && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setEditing(false);
              }}
            >
              Back to routes
            </button>
          )}
        </div>
      ),
      body: (
        <>
          {form}
          <Attribution />
        </>
      ),
    },
    loading: { peek: loading, body: null },
    error: {
      peek: failed && (
        <div className={styles.stack}>
          <ErrorState error={failed} onRetry={retry} />
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setEditing(true);
            }}
          >
            Change the trip
          </button>
        </div>
      ),
      body: null,
    },
    results: {
      peek: plan && (
        <div className={styles.stack}>
          <TripSummary
            plan={plan}
            onEdit={() => {
              setEditing(true);
            }}
          />
          <Recommendation plan={plan} />
        </div>
      ),
      body: (
        <>
          {results}
          <Attribution />
        </>
      ),
    },
  };

  return (
    <main className={styles.app}>
      <div className={styles.header}>
        <AppHeader apiStatus={apiStatus} />
      </div>
      <div className={styles.mapArea}>
        {map}
        {details}
        <BottomSheet
          label="Trip"
          snap={snap}
          onSnapChange={(next) => {
            setSheet({ view, snap: next });
          }}
          onHeightChange={setSheetHeight}
          peek={sheetContent[view].peek}
        >
          {sheetContent[view].body}
        </BottomSheet>
      </div>
    </main>
  );
}
