import { useId } from "react";

import { rankedRoutes, routeById } from "../../lib/plan";
import type { TripPlan } from "../../lib/types";
import { HazardList } from "./HazardList";
import { Recommendation } from "./Recommendation";
import styles from "./results.module.css";
import { MarkerLegend, RiskLegend } from "./RiskVisuals";
import { RouteCard } from "./RouteCard";

interface TripResultsProps {
  plan: TripPlan;
  selectedRouteId: string;
  selectedCheckpoint: number | null;
  onSelectRoute: (routeId: string) => void;
  onSelectCheckpoint: (index: number) => void;
  /** Phones show the recommendation in the sheet's peek area instead. */
  showRecommendation?: boolean;
}

export function TripResults({
  plan,
  selectedRouteId,
  selectedCheckpoint,
  onSelectRoute,
  onSelectCheckpoint,
  showRecommendation = true,
}: TripResultsProps) {
  const routesId = useId();
  const selected = routeById(plan, selectedRouteId);
  return (
    <div className={styles.results}>
      {showRecommendation && <Recommendation plan={plan} />}
      <section aria-labelledby={routesId}>
        <h3 id={routesId} className={styles.section}>
          <span>Routes</span>
          <span className={styles.sectionHint}>ranked by weather risk, then time</span>
        </h3>
        <div className={styles.cards}>
          {rankedRoutes(plan).map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              recommended={route.id === plan.recommendation.route_id}
              selected={route.id === selectedRouteId}
              onSelect={onSelectRoute}
            />
          ))}
        </div>
      </section>
      {selected && (
        <HazardList
          route={selected}
          selectedIndex={selectedCheckpoint}
          onSelect={onSelectCheckpoint}
        />
      )}
      <div className={styles.legends}>
        <RiskLegend />
        <MarkerLegend />
      </div>
    </div>
  );
}
