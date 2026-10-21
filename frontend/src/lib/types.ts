/** Shapes of the Clearway API (see docs/api.md). Field names follow the API's JSON. */

export type RiskLevel = "low" | "moderate" | "high" | "severe" | "no_travel";

export type RiskCause = "wind" | "rain" | "snow" | "load";

export type Interval = 10 | 25 | 50;

export interface Suggestion {
  id: string;
  type: string;
  title: string;
  subtitle: string;
}

/** One of the three ways to name a place: a picked suggestion, coordinates or free text. */
export type LocationInput =
  { place_id: string; place_type: string } | { lat: number; lon: number } | { query: string };

export interface TripRequest {
  origin: LocationInput;
  destination: LocationInput;
  departure: string;
  load_lb: number;
  interval_mi: Interval;
}

export interface Weather {
  wind_mph: number;
  gust_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
}

export interface CheckpointRisk {
  level: RiskLevel;
  score: number;
  wind: RiskLevel;
  rain: RiskLevel;
  snow: RiskLevel;
  causes: RiskCause[];
}

export interface Checkpoint {
  index: number;
  mile: number;
  lat: number;
  lon: number;
  eta: string;
  weather: Weather;
  risk: CheckpointRisk;
}

export interface RouteRisk {
  miles: Record<RiskLevel, number>;
  average: number;
  worst: RiskLevel;
}

export interface PlannedRoute {
  id: string;
  rank: number;
  distance_mi: number;
  duration_s: number;
  traffic_delay_s: number;
  departure: string;
  arrival: string;
  detour: boolean;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  risk: RouteRisk;
  checkpoints: Checkpoint[];
}

export interface PlacePoint {
  title: string;
  lat: number;
  lon: number;
}

export interface Recommendation {
  route_id: string;
  reason: string;
  safe: boolean;
}

/** One corridor cell: a value per hourly frame, null where the forecast had none. */
export interface HeatmapCell {
  lat: number;
  lon: number;
  /** Risk score per frame, 0 (Low) to 4 (No Travel). */
  risk: (number | null)[];
  wind: (number | null)[];
  rain: (number | null)[];
  snow: (number | null)[];
}

/** Frame ``i`` is the weather at ``start`` plus ``i`` hours. */
export interface Heatmap {
  start: string;
  frames: number;
  spacing_m: number;
  /** A cell's size in degrees; cells are squares on the ground that tile the corridor. */
  cell_size: { lat: number; lon: number };
  cells: HeatmapCell[];
}

export interface TripPlan {
  origin: PlacePoint;
  destination: PlacePoint;
  load_lb: number;
  interval_mi: Interval;
  routes: PlannedRoute[];
  recommendation: Recommendation;
  notes: string[];
  /** Null when the corridor weather could not be fetched; the routes are still planned. */
  heatmap: Heatmap | null;
}
