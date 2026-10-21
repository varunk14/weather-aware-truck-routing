import { useId } from "react";

import { formatLocalTime, formatMiles, formatWeight } from "../../lib/format";
import { coveredMiles } from "../../lib/plan";
import type { PlannedRoute } from "../../lib/types";
import styles from "./results.module.css";
import { RiskChip } from "./RiskVisuals";

interface CheckpointDetailsProps {
  route: PlannedRoute;
  index: number;
  loadLb: number;
  onClose: () => void;
}

/** The forecast and risk at one checkpoint, for the hour the truck is expected there. */
export function CheckpointDetails({ route, index, loadLb, onClose }: CheckpointDetailsProps) {
  const titleId = useId();
  const checkpoint = route.checkpoints[index];
  if (!checkpoint) return null;
  const { weather, risk } = checkpoint;
  const raisedByLoad = risk.causes.includes("load");

  return (
    <section className={styles.details} aria-labelledby={titleId}>
      <div className={styles.detailsHead}>
        <h3 id={titleId} className={styles.detailsTitle}>
          Route {route.id} · mile {Math.round(checkpoint.mile).toLocaleString("en-US")}
        </h3>
        <RiskChip level={risk.level} />
        <button
          type="button"
          className={styles.close}
          aria-label="Close checkpoint details"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <p className={styles.detailsEta}>Truck arrives {formatLocalTime(checkpoint.eta)}</p>
      <table className={styles.weather}>
        <caption className="visually-hidden">Forecast for the hour of arrival</caption>
        <tbody>
          <tr>
            <th scope="row">Wind</th>
            <td>
              {weather.wind_mph.toFixed(0)} mph{" "}
              <span className={styles.muted}>gusts {weather.gust_mph.toFixed(0)}</span>
            </td>
            <td>
              <RiskChip level={risk.wind} />
            </td>
          </tr>
          <tr>
            <th scope="row">Rain</th>
            <td>{weather.rain_in_hr.toFixed(2)} in/hr</td>
            <td>
              <RiskChip level={risk.rain} />
            </td>
          </tr>
          <tr>
            <th scope="row">Snow</th>
            <td>{weather.snow_in_hr.toFixed(2)} in/hr</td>
            <td>
              <RiskChip level={risk.snow} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className={styles.note}>
        {raisedByLoad && `A ${formatWeight(loadLb)} load makes this wind more dangerous. `}
        Stands for about {formatMiles(coveredMiles(route.checkpoints, index))} of road around this
        point.
      </p>
    </section>
  );
}
