import type { ApiStatus } from "../../hooks/useApiStatus";
import { ApiStatusBadge } from "../ApiStatusBadge/ApiStatusBadge";
import { BrandMark } from "../BrandMark";
import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  apiStatus: ApiStatus;
}

export function AppHeader({ apiStatus }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <BrandMark className={styles.mark} />
      <div className={styles.titles}>
        <h1 className={styles.name}>Clearway</h1>
        <p className={styles.tagline}>Weather-aware truck routing</p>
      </div>
      <ApiStatusBadge status={apiStatus} />
    </header>
  );
}
