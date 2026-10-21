import styles from "./Attribution.module.css";

const SOURCES = [
  { label: "Routing by TomTom", href: "https://www.tomtom.com" },
  { label: "Weather data by Open-Meteo.com", href: "https://open-meteo.com" },
  {
    label: "Map data © OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright",
  },
  { label: "Tiles by OpenFreeMap", href: "https://openfreemap.org" },
];

/** Credits for the data behind every plan. */
export function Attribution() {
  return (
    <p className={styles.attribution}>
      {SOURCES.map((source, index) => (
        <span key={source.href}>
          {index > 0 && " · "}
          <a href={source.href} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        </span>
      ))}
    </p>
  );
}
