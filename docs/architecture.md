# Architecture

Clearway is a single-page web app and a small stateless API. The browser never talks to the
routing or weather services directly: every third-party call goes through the API, which keeps
the TomTom key on the server and lets the API cache and rate limit.

```
 Browser (React, MapLibre GL)                 API (Django, Django REST Framework)
 ┌───────────────────────────┐   JSON, gzip   ┌──────────────────────────────────────┐
 │ trip form, results panel  │ ─────────────► │ /api/places/suggest   /api/routes    │
 │ map, heatmap, timeline    │ ◄───────────── │ /api/health                          │
 └─────────────┬─────────────┘                └──────┬───────────────────┬───────────┘
               │ map tiles                           │ truck routing,    │ hourly forecast
               ▼                                     ▼ places            ▼
         OpenFreeMap                              TomTom              Open-Meteo
```

## The API

`backend/routing` holds the application, in layers that only call downwards:

| Layer           | Modules                                         | Knows about               |
| --------------- | ----------------------------------------------- | ------------------------- |
| HTTP            | `views.py`, `serializers.py`, `api_errors.py`   | requests, responses       |
| Trip planning   | `services/planner.py` and the other `services/` | the steps of a plan       |
| Service clients | `clients/tomtom.py`, `clients/open_meteo.py`    | one third-party API each  |
| Risk rules      | `risk/` (classification, scoring, ranking)      | nothing else: pure Python |

The risk rules have no Django, HTTP or I/O in them, so every threshold and load rule is tested
directly (see [risk-model.md](risk-model.md)). The clients turn every upstream failure into a
typed error, and `api_errors.py` turns those into clear responses (503 when a service is down or
over its limit, 422 when no route exists), never a bare 500.

### Planning a trip (`POST /api/routes`)

1. **Places.** Origin and destination are resolved at the same time (a picked suggestion, typed
   text or coordinates). Trips longer than 3,500 miles in a straight line are refused before any
   routing request.
2. **Cache.** Plans are cached for an hour, keyed by both places, the departure, load and
   spacing, so a repeated trip calls neither service.
3. **Three routes.** TomTom's fastest route and its alternatives are requested in parallel. If
   the alternatives are slow or too few, detours through points beside the fastest route complete
   the set; the first complete set wins, and nothing waits longer than 20 seconds
   (`services/route_options.py`).
4. **Checkpoints.** Each route gets a checkpoint every 10, 25 or 50 miles, with the time the
   truck reaches it from TomTom's travel times (`services/checkpoints.py`).
5. **Weather.** One Open-Meteo lookup covers the checkpoints of all three routes, each for the
   hour the truck arrives (`services/weather.py`). At the same time, a second lookup fetches 50
   hours of weather for the corridor heatmap (`services/heatmap.py`). Only the heatmap may fail
   without failing the plan.
6. **Risk and ranking.** Each checkpoint gets a level from wind, rain, snow and the load; each
   route its miles per level; the routes are ranked and one is recommended (`risk/`).
7. **Response.** One JSON document with the routes, checkpoints, recommendation and heatmap,
   gzip compressed (about 15 to 70 KB).

### Running it

The API keeps no database and no files. Plans, forecasts and place lookups live in an in-memory
cache, so the hosted API runs as one Gunicorn process with eight threads
(`backend/gunicorn.conf.py`): every request sees the same cache, and the threads cover the time
spent waiting on TomTom and Open-Meteo. Per-client rate limits (60 suggestions and 10 plans a
minute) protect the third-party quotas.

## The web app

`frontend/src` is organised by feature:

| Folder              | Holds                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `app/`              | the layout: side panel on wide screens, bottom sheet on phones          |
| `features/trip/`    | the form, place suggestions, the departure picker, the planning request |
| `features/results/` | the recommendation, route cards, risky checkpoints, checkpoint details  |
| `features/map/`     | the MapLibre map: routes, checkpoints, start and end, the truck         |
| `features/heatmap/` | heatmap paint expressions, truck position, the forecast timeline        |
| `lib/`              | the API client, response types, formatting, the risk scale              |

State is plain React: the planner hook owns the request and the plan, `App` owns what is
selected and where the slider is, and each part of the screen receives what it shows. MapLibre
is loaded as its own chunk after the first paint, since it is most of the code.

### The map

The map has one source per kind of data (routes, checkpoints, start and end, heatmap), and each
is sent to the map only when its own data changes. The heatmap is sent once per plan with every
hourly frame on each cell; moving the slider only replaces the layer's colour expression, so
scrubbing makes no requests and uploads nothing, and stays at 60 frames a second.

## Hosting

`render.yaml` describes both parts on Render's free plan: the web app as a static site and the
API as a web service. Each learns the other's address from the platform at deploy time. A free
API instance sleeps after 15 minutes without requests; a scheduled GitHub Actions job
(`.github/workflows/keep-warm.yml`) calls `/api/health` every 10 minutes to keep it awake, and
the web app says the API is starting up if a visitor arrives while it wakes.

## Quality checks

`make check` runs what CI runs on every pull request: Ruff, mypy and pytest for the API;
ESLint, Prettier, TypeScript, Vitest and a production build for the web app; and Playwright end
to end tests on a desktop and a phone profile. Tests never call TomTom or Open-Meteo: recorded
responses and fakes stand in for them.
