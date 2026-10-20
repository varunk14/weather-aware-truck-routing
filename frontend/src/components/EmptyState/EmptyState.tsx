import styles from "./EmptyState.module.css";

const RANKING = [
  "Fewest miles in Severe weather",
  "Fewest miles in High-risk weather",
  "Lowest average risk",
  "Shortest travel time",
];

export function EmptyState() {
  return (
    <section className={styles.empty} aria-labelledby="empty-state-title">
      <h2 id="empty-state-title" className={styles.title}>
        Plan a trip
      </h2>
      <p className={styles.lead}>
        Enter an origin, destination, departure time and load weight. Clearway compares three routes
        by the weather the truck will meet at each checkpoint and recommends the safest one.
      </p>
      <h3 className={styles.subtitle}>How routes are ranked</h3>
      <ol className={styles.list}>
        {RANKING.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ol>
    </section>
  );
}
