import { lazy, Suspense } from "react";

import { AppHeader } from "../components/AppHeader/AppHeader";
import { EmptyState } from "../components/EmptyState/EmptyState";
import { useApiStatus } from "../hooks/useApiStatus";
import styles from "./App.module.css";

// MapLibre is the largest dependency; loading it separately keeps the first paint fast.
const MapView = lazy(() => import("../features/map/MapView"));

export function App() {
  const apiStatus = useApiStatus();

  return (
    <main className={styles.app}>
      <section className={styles.panel} aria-label="Trip planner">
        <AppHeader apiStatus={apiStatus} />
        <div className={styles.panelBody}>
          <EmptyState />
        </div>
      </section>
      <div className={styles.mapArea}>
        <Suspense fallback={<div className={styles.mapLoading} aria-hidden="true" />}>
          <MapView />
        </Suspense>
      </div>
    </main>
  );
}
