# API

All endpoints are under `/api`, accept and return JSON, and need no authentication.
Third-party services (TomTom) are only ever called by the API, never by the browser.

## `GET /api/health`

Liveness check used by the hosting platform, the uptime monitor and the web app.

```json
{ "status": "ok", "version": "0.1.0", "time": "2026-10-21T12:00:00.000000+00:00" }
```

## `GET /api/places/suggest?q=…`

Place suggestions while the user types an origin or destination. Results are limited to the
United States, Canada and Mexico.

| Parameter | Rules                                                                             |
| --------- | --------------------------------------------------------------------------------- |
| `q`       | Text typed so far. Under 2 characters returns no results. At most 100 characters. |

```json
{
  "results": [
    {
      "id": "T2ME35qKUleNLKiycGnySA",
      "type": "areas",
      "title": "Denver, CO",
      "subtitle": "United States"
    }
  ]
}
```

## `POST /api/routes`

Three truck route options between two places, each with checkpoints and the truck's
estimated arrival time at every checkpoint.

### Request

```json
{
  "origin": { "query": "Chicago, IL" },
  "destination": { "place_id": "T2ME35qKUleNLKiycGnySA", "place_type": "areas" },
  "departure": "2026-10-21T12:00:00Z",
  "load_lb": 38000,
  "interval_mi": 25
}
```

| Field                   | Rules                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `origin`, `destination` | Exactly one form: a picked suggestion (`place_id` + `place_type`), coordinates (`lat` + `lon`), or free text (`query`). They must be different places. |
| `departure`             | ISO 8601. From 15 minutes ago up to 7 days ahead. A time without an offset is read as UTC.                                                             |
| `load_lb`               | Whole pounds, 1 to 80,000.                                                                                                                             |
| `interval_mi`           | Checkpoint spacing: 10, 25 or 50. Default 25.                                                                                                          |

### Response

```json
{
  "origin": { "title": "Chicago, IL", "lat": 41.88323, "lon": -87.6324 },
  "destination": { "title": "Denver, CO", "lat": 39.73845, "lon": -104.98485 },
  "load_lb": 38000,
  "interval_mi": 25,
  "routes": [
    {
      "id": "A",
      "distance_mi": 1006.3,
      "duration_s": 50791,
      "traffic_delay_s": 0,
      "departure": "2026-10-21T07:00:00-05:00",
      "arrival": "2026-10-21T20:06:31-06:00",
      "detour": false,
      "geometry": { "type": "LineString", "coordinates": [[-87.6324, 41.88323]] },
      "checkpoints": [
        {
          "index": 0,
          "mile": 0.0,
          "lat": 41.88323,
          "lon": -87.6324,
          "eta": "2026-10-21T07:00:00-05:00"
        }
      ]
    }
  ],
  "notes": []
}
```

- Routes are returned in TomTom's order (fastest first) and labelled A, B, C.
- `departure` and checkpoint `eta` use the origin's UTC offset; `arrival` uses the
  destination's. They are exact instants and can be converted freely.
- `geometry` is simplified for drawing (every removed point lies within 30 m of the line).
  Checkpoints are placed on the full-detail route.
- `detour: true` marks a route found by routing through a point beside the main route, used when
  TomTom offers fewer than three alternatives. `notes` explains this, and says so when fewer than
  three distinct routes exist.

### Errors

| Status | When                                                                      |
| ------ | ------------------------------------------------------------------------- |
| 400    | The request is invalid; the body names each field and the reason.        |
| 422    | A place cannot be found, or no truck route connects the places.           |
| 429    | Too many requests from this client; retry after the `Retry-After` header. |
| 502    | TomTom returned a response the API could not use.                         |
| 503    | TomTom is not responding, or routing is not configured.                   |

Error bodies have a `detail` message, for example
`{"detail": "No truck route connects these places."}`.

## Rate limits

Per client IP address: 60 suggestion requests and 10 route requests per minute. Identical trips
are cached for 15 minutes and place lookups for a day, so reloading does not use the quota again.
