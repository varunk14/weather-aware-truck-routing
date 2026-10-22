import { lazy, type ReactNode, Suspense, useCallback, useMemo, useState } from "react";

import { AppHeader } from "../components/AppHeader/AppHeader";
import { Attribution } from "../components/Attribution/Attribution";
import { BottomSheet, type SheetSnap } from "../components/BottomSheet/BottomSheet";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { ErrorBoundary } from "../components/ErrorBoundary/ErrorBoundary";
import type { HeatLayer } from "../features/heatmap/heatmap";
import { Timeline } from "../features/heatmap/Timeline";
import { truckAt } from "../features/heatmap/truck";
import type { MapPadding } from "../features/map/MapView";
import { CheckpointDetails } from "../features/results/CheckpointDetails";
import { ErrorState, LoadingState } from "../features/results/PlanStatus";
import { Recommendation } from "../features/results/Recommendation";
import { TripResults } from "../features/results/TripResults";
import { TripSummary } from "../features/results/TripSummary";
import { TripForm } from "../features/trip/TripForm";
import { useTripPlanner } from "../features/trip/useTripPlanner";
import { useApiStatus } from "../hooks/useApiStatus";
import { useElementHeight } from "../hooks/useElementHeight";
import { PHONE_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { formatDuration } from "../lib/format";
import { routeById } from "../lib/plan";
import type { TripPlan } from "../lib/types";
import styles from "./App.module.css";

// MapLibre is the largest dependency; loading it separately keeps the first paint fast.
const MapView = lazy(() => import("../features/map/MapView"));

/** What the phone's bottom sheet shows, and where it starts for each. */
type SheetView = "form" | "loading" | "error" | "results";
const SHEET_START: Record<SheetView, SheetSnap> = {
  form: "full",
  loading: "peek",
  error: "peek",
  results: "peek",
};

const DESKTOP_EDGE = 48;
// Room around routes on a phone, so end markers and their labels stay on screen.
const PHONE_EDGE = 32;
// The timeline floats this far above the sheet on a phone; on larger screens it sits above
// the map's credits line, which must stay visible.
const TIMELINE_GAP = 12;
const CREDITS_CLEARANCE = 40;

interface Selection {
  plan: TripPlan | null;
  routeId: string | null;
  checkpoint: number | null;
}

/** The forecast slider; like the selection, it belongs to one plan and starts at departure. */
interface Forecast {
  plan: TripPlan | null;
  hour: number;
  playing: boolean;
}

/** What a screen reader hears when a plan arrives (errors are announced by their alert). */
function announce(plan: TripPlan | null): string {
  if (!plan) return "";
  const best = routeById(plan, plan.recommendation.route_id);
  const duration = best ? `, ${formatDuration(best.duration_s)}` : "";
  return `Routes ready. Recommended: Route ${plan.recommendation.route_id}${duration}. ${plan.recommendation.reason}`;
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

  const [forecast, setForecast] = useState<Forecast>({ plan: null, hour: 0, playing: false });
  const [heatLayer, setHeatLayer] = useState<HeatLayer>("risk");
  const shownForecast: Forecast =
    forecast.plan === plan ? forecast : { plan, hour: 0, playing: false };
  const setHour = useCallback(
    (hour: number) => {
      setForecast((last) => ({ ...(last.plan === plan ? last : { playing: false }), plan, hour }));
    },
    [plan],
  );
  const setPlaying = useCallback(
    (playing: boolean) => {
      setForecast((last) => ({ ...(last.plan === plan ? last : { hour: 0 }), plan, playing }));
    },
    [plan],
  );
  const truck = useMemo(
    () => (route ? truckAt(route, shownForecast.hour) : null),
    [route, shownForecast.hour],
  );

  let view: SheetView = "form";
  if (state.status === "loading") view = "loading";
  else if (failed && !editing) view = "error";
  else if (plan && !editing) view = "results";

  // Every time the sheet shows something new it starts at that view's position; the user can
  // move it from there.
  const [sheetView, setSheetView] = useState<SheetView>(view);
  const [snap, setSnap] = useState<SheetSnap>(SHEET_START[view]);
  if (sheetView !== view) {
    setSheetView(view);
    setSnap(SHEET_START[view]);
  }
  const [sheetHeight, setSheetHeight] = useState(0);

  // The timeline shows with a plan's results; on a phone only with the sheet lowered, since any
  // higher it would cover most of the map.
  // An open checkpoint's details take the top of a phone's map, so the timeline makes way.
  const showTimeline =
    Boolean(plan && route) &&
    (!phone || (view === "results" && snap === "peek" && current.checkpoint === null));
  // Hiding the timeline pauses it, so it never starts playing again by itself when it returns.
  if (!showTimeline && shownForecast.playing) {
    setForecast({ ...shownForecast, playing: false });
  }
  const [timelineRef, timelineHeight] = useElementHeight();
  const timelineBottom = phone ? sheetHeight + TIMELINE_GAP : CREDITS_CLEARANCE;
  const timelineSpace = showTimeline
    ? timelineHeight + (phone ? TIMELINE_GAP : CREDITS_CLEARANCE)
    : 0;

  const padding = useMemo<MapPadding>(
    () =>
      phone
        ? {
            top: PHONE_EDGE,
            right: PHONE_EDGE,
            bottom: sheetHeight + timelineSpace + PHONE_EDGE,
            left: PHONE_EDGE,
          }
        : {
            top: DESKTOP_EDGE,
            right: DESKTOP_EDGE,
            bottom: timelineSpace + DESKTOP_EDGE,
            left: DESKTOP_EDGE,
          },
    [phone, sheetHeight, timelineSpace],
  );

  function onSubmit(): boolean {
    const valid = submit();
    if (valid) setEditing(false);
    return valid;
  }

  function selectRoute(routeId: string) {
    setSelection({ plan, routeId, checkpoint: null });
    if (phone) setSnap("peek");
  }

  function selectCheckpoint(checkpoint: number) {
    setSelection({ ...current, checkpoint });
    if (phone) setSnap("peek");
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
    <ErrorBoundary
      resetKey={plan}
      fallback={
        <p className={styles.problem} role="alert">
          This plan could not be shown. Try planning the trip again.
        </p>
      }
    >
      <TripResults
        plan={plan}
        selectedRouteId={current.routeId}
        selectedCheckpoint={current.checkpoint}
        onSelectRoute={selectRoute}
        onSelectCheckpoint={selectCheckpoint}
        showRecommendation={!phone}
      />
    </ErrorBoundary>
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

  // One tree for both layouts, so the map survives a rotation or resize across the breakpoint.
  return (
    <main className={styles.app}>
      <div className={styles.header}>
        <AppHeader apiStatus={apiStatus} />
      </div>
      {phone ? null : (
        <section className={styles.panel} aria-label="Trip planner">
          {form}
          {loading}
          {failed && <ErrorState error={failed} onRetry={retry} />}
          {results}
          {state.status === "idle" && <EmptyState />}
          <Attribution />
        </section>
      )}
      <div className={styles.mapArea}>
        <ErrorBoundary
          fallback={
            <div className={styles.mapProblem} role="region" aria-label="Route map">
              <p>The map could not be loaded. Reload the page to try again.</p>
            </div>
          }
        >
          <Suspense fallback={<div className={styles.mapLoading} aria-hidden="true" />}>
            <MapView
              plan={plan}
              selectedRouteId={current.routeId}
              selectedCheckpoint={current.checkpoint}
              padding={padding}
              onSelectRoute={selectRoute}
              onSelectCheckpoint={selectCheckpoint}
              heatLayer={showTimeline ? heatLayer : null}
              hour={shownForecast.hour}
              truck={showTimeline ? truck : null}
            />
          </Suspense>
        </ErrorBoundary>
        {details}
        {showTimeline && plan && route && (
          <div ref={timelineRef} className={styles.timeline} style={{ bottom: timelineBottom }}>
            <Timeline
              departure={route.departure}
              hour={shownForecast.hour}
              onHourChange={setHour}
              playing={shownForecast.playing}
              onPlayingChange={setPlaying}
              layer={heatLayer}
              onLayerChange={setHeatLayer}
              routeId={route.id}
              arrivalHour={(Date.parse(route.arrival) - Date.parse(route.departure)) / 3_600_000}
              truck={truck}
              heatmap={Boolean(plan.heatmap)}
            />
          </div>
        )}
        {phone && (
          <BottomSheet
            label="Trip"
            snap={snap}
            onSnapChange={setSnap}
            onHeightChange={setSheetHeight}
            peek={sheetContent[view].peek}
          >
            {sheetContent[view].body}
          </BottomSheet>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce(plan)}
      </p>
    </main>
  );
}
