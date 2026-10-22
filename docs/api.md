# API

All endpoints are under `/api`, accept and return JSON, and need no authentication.
Third-party services (TomTom, Open-Meteo) are only ever called by the API, never by the browser.

## `GET /api/health`

Liveness check used by the hosting platform, the uptime monitor and the web app.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "time": "2026-10-21T12:00:00.000000+00:00"
}
```

## `GET /api/places/suggest?q=…`

Place suggestions while the user types an origin or destination, anywhere in the world.

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

Three truck route options between two places. Each route has checkpoints with the truck's
estimated arrival time, the forecast weather for that hour and its risk level, and a route-level
risk summary. One route is recommended, with a sentence explaining why.

### Request

```json
{
  "origin": { "query": "Chicago, IL" },
  "destination": {
    "place_id": "T2ME35qKUleNLKiycGnySA",
    "place_type": "areas"
  },
  "departure": "2026-10-21T12:00:00Z",
  "load_lb": 38000,
  "interval_mi": 25
}
```

| Field                   | Rules                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin`, `destination` | Exactly one form: a picked suggestion (`place_id` + `place_type`), coordinates (`lat` + `lon`), or free text (`query`). They must be different places, at most 3,500 mi apart by road. |
| `departure`             | ISO 8601. From 15 minutes ago up to 10 days ahead. A time without an offset is read as UTC.                                                                                            |
| `load_lb`               | Whole pounds, 1 to 80,000.                                                                                                                                                             |
| `interval_mi`           | Checkpoint spacing: 10, 25 or 50. Default 25. A trip whose checkpoints need more than 450 forecast points (10 mi spacing beyond about 1,500 mi) is refused with a 400 on this field.   |

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
      "geometry": {
        "type": "LineString",
        "coordinates": [[-87.6324, 41.88323]]
      },
      "rank": 1,
      "risk": {
        "miles": {
          "low": 981.3,
          "moderate": 25.0,
          "high": 0.0,
          "severe": 0.0,
          "no_travel": 0.0
        },
        "average": 0.025,
        "worst": "moderate"
      },
      "checkpoints": [
        {
          "index": 0,
          "mile": 0.0,
          "lat": 41.88323,
          "lon": -87.6324,
          "eta": "2026-10-21T07:00:00-05:00",
          "weather": {
            "wind_mph": 12.4,
            "gust_mph": 21.7,
            "rain_in_hr": 0.12,
            "snow_in_hr": 0.0
          },
          "risk": {
            "level": "moderate",
            "score": 1,
            "wind": "low",
            "rain": "moderate",
            "snow": "low",
            "causes": ["rain"]
          }
        }
      ]
    }
  ],
  "recommendation": {
    "route_id": "A",
    "reason": "Fastest route, and no other route has less weather risk.",
    "safe": true
  },
  "notes": [],
  "heatmap": {
    "start": "2026-10-21T18:00:00+00:00",
    "frames": 50,
    "spacing_m": 20000,
    "cell_size": { "lat": 0.17966, "lon": 0.24155 },
    "cells": [
      {
        "lat": 41.8705,
        "lon": -87.6346,
        "risk": [0, 0, 1, 2, "… one per frame"],
        "wind": [8.1, 9.4, 26.0, 38.2, "…"],
        "rain": [0.0, 0.0, 0.02, 0.0, "…"],
        "snow": [0.0, 0.0, 0.0, 0.0, "…"]
      }
    ]
  }
}
```

- Routes are returned in TomTom's order (fastest first) and labelled A, B, C.
- `departure` and checkpoint `eta` use the origin's UTC offset; `arrival` uses the
  destination's. They are exact instants and can be converted freely.
- `geometry` is simplified for drawing (every removed point lies within 30 m of the line).
  Checkpoints are placed on the full-detail route.
- `detour: true` marks a route found by routing through a point beside the fastest route. Detours
  complete the set when TomTom's own alternatives are slow or too few; `notes` says which routes
  are detours, and says so when fewer than three distinct routes were found.
- `rank` orders the routes from safest (1) by the rules in the risk model; the route ranked 1 is
  the one in `recommendation`. `safe: false` means every route, including the recommended one,
  crosses No Travel conditions.
- Risk levels are `low`, `moderate`, `high`, `severe` and `no_travel`; `score` is 0 to 4.
  `causes` lists what set the checkpoint's level: `wind`, `rain`, `snow`, or `wind` and `load`
  when a heavy load raised the wind level.
- `risk.miles` gives the miles of road at each level (each checkpoint stands for the road halfway
  to its neighbours); `average` is the mile-weighted mean score.
- `heatmap` is the weather over a corridor around all the routes, for the 0 to 48 hour slider.
  Frame `i` is the hour `start` plus `i` hours (whole UTC hours from the hour of departure).
  Each cell is a square `cell_size` degrees across, centred on `lat` and `lon`, with one value
  per frame: `risk` as a score (0 Low to 4 No Travel, using the trip's load), wind in mph, rain
  (including showers) and snow in inches per hour. A value is `null` where the forecast had
  none. `heatmap` is `null` when the corridor weather could not be fetched; the routes are
  planned regardless.
- `weather` is the forecast for the hour the truck reaches the checkpoint: wind in mph, rain
  (including showers) and snow in inches per hour. Gusts are shown for context; the risk level
  uses the sustained wind speed.

### Errors

| Status | When                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------ |
| 400    | The request is invalid, or the trip is longer than 3,500 mi; the body names each field and the reason. |
| 422    | A place cannot be found, or no truck route connects the places.                                        |
| 429    | Too many requests from this client; retry after the `Retry-After` header.                              |
| 502    | TomTom or Open-Meteo returned a response the API could not use, or the forecast has gaps.              |
| 503    | TomTom or Open-Meteo is not responding or is rate limiting, or routing is not configured.              |

Error bodies have a `detail` message, for example
`{"detail": "No truck route connects these places."}`.

## Rate limits

Per client IP address: 60 suggestion requests and 10 route requests per minute. Identical trips
are cached for an hour, weather included, and place lookups for a day, so reloading does not
use the quota again.
