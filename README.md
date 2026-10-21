# Clearway

[![CI](https://github.com/varunk14/weather-aware-truck-routing/actions/workflows/ci.yml/badge.svg)](https://github.com/varunk14/weather-aware-truck-routing/actions/workflows/ci.yml)

Weather-aware truck route planner. Clearway compares three truck routes between two places,
forecasts the weather the truck will meet at each checkpoint at the hour it gets there, rates the
risk from wind, rain, snow and the load weight, and recommends the safest route.

**Live demo: [clearway-phwi.onrender.com](https://clearway-phwi.onrender.com)** (API health:
[clearway-api-hs9v.onrender.com/api/health](https://clearway-api-hs9v.onrender.com/api/health))

![Clearway on a desktop: three routes from Seattle to Salt Lake City, checkpoints coloured by risk, and the weather heatmap 37.5 hours after departure](docs/screenshots/desktop.webp)

## What it does

- **Plan a trip:** origin and destination anywhere TomTom has truck routing (up to 3,500 miles
  apart), a departure up to 10 days ahead, the load in pounds, and a checkpoint every 10, 25 or
  50 miles.
- **Three truck routes** from TomTom's truck profile with the load weight, each with checkpoints
  and the time the truck reaches every one.
- **Weather at each checkpoint for the hour the truck arrives** (Open-Meteo): wind, rain with
  showers, and snow.
- **Risk per checkpoint** from the specification's thresholds and load rules, and per route the
  miles at each level and the average risk.
- **A recommendation** with a one-line reason. Routes rank by fewest miles in No Travel, then
  Severe, then High, then the lowest average risk, then the shortest travel time.
- **A map** of all three routes, with checkpoints coloured by risk; hover or tap one for its
  forecast.
- **A weather heatmap** along the trip corridor, with a 0 to 48 hour slider (play, and Risk,
  Wind, Rain or Snow) and the truck's position at that hour. Every hour loads with the plan, so
  the slider never waits for the network.
- **Phones:** the map fills the screen and the plan sits in a sheet that slides up.

| Condition    | Low    | Moderate    | High        | Severe      | No Travel |
| ------------ | ------ | ----------- | ----------- | ----------- | --------- |
| Wind (mph)   | < 25   | 25 to 34    | 35 to 44    | 45 to 54    | ≥ 55      |
| Rain (in/hr) | < 0.10 | 0.10 – 0.25 | 0.25 – 0.50 | 0.50 – 1.00 | > 1.00    |
| Snow (in/hr) | < 0.5  | 0.5 – 1.0   | 1.0 – 2.0   | 2.0 – 3.0   | > 3.0     |

Load rules: 45 to 54 mph over 30,000 lb is No Travel; 35 to 44 mph over 40,000 lb is Severe. How
band edges, route scores and the ranking work, with examples: [docs/risk-model.md](docs/risk-model.md).

<p align="center">
  <img src="docs/screenshots/phone.webp" width="300" alt="Clearway on a phone: the map with the heatmap, the forecast timeline above the trip sheet, and the recommended route">
</p>

## How it works

The React web app sends the trip to a Django API, which makes every third-party call, so the
TomTom key never reaches the browser. The API resolves both places at once, asks TomTom for the
fastest route and its alternatives in parallel (with detours to complete the set when they are
slow), places the checkpoints, and fetches the weather for all checkpoints of all three routes in
one Open-Meteo lookup, alongside a second for the 48 hour corridor heatmap. The risk rules are
plain Python with no framework or I/O, tested on every band edge. The map is MapLibre GL; moving
the slider only changes a paint expression. More in [docs/architecture.md](docs/architecture.md).

## Tech stack

| Layer   | Technology                                                               |
| ------- | ------------------------------------------------------------------------ |
| API     | Python 3.12, Django 5.2 LTS, Django REST Framework                       |
| Web     | React 19, TypeScript, Vite, MapLibre GL                                  |
| Data    | TomTom (routing, geocoding), Open-Meteo (weather), OpenFreeMap (basemap) |
| Quality | Ruff, mypy, pytest, ESLint, Prettier, Vitest, Playwright, GitHub Actions |

## Getting started

### Prerequisites

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js 24 and [pnpm](https://pnpm.io/) 10
- `make`

### Run locally

```bash
git clone https://github.com/varunk14/weather-aware-truck-routing.git
cd weather-aware-truck-routing
make install
cp backend/.env.example backend/.env   # then add your TomTom API key
make dev
```

Open http://localhost:5173. The web app proxies `/api` to the API on http://127.0.0.1:8000.

## Commands

| Command        | What it does                                 |
| -------------- | -------------------------------------------- |
| `make install` | Install backend and frontend dependencies    |
| `make dev`     | Run the API and the web app together         |
| `make lint`    | Lint, format-check and type-check both apps  |
| `make format`  | Format both apps                             |
| `make test`    | Run unit and integration tests with coverage |
| `make e2e`     | Run browser end-to-end tests                 |
| `make check`   | Run every check that CI runs                 |
| `make build`   | Build the web app for production             |

## Hosting

Both parts run on [Render](https://render.com)'s free plan, described in
[`render.yaml`](render.yaml): the web app as a static site and the API as a web service.

1. In the Render Dashboard choose **New > Blueprint** and pick this repository.
2. Enter `TOMTOM_API_KEY` when asked. The Django secret key is generated, and each service gets
   the other's address (for the API's allowed origin and the web app's API address) from Render.
3. To keep the free API awake, add a repository variable `API_HEALTH_URL` with the API's
   health address (for example `https://clearway-api.onrender.com/api/health`); the
   `keep-warm` workflow then calls it every 10 minutes.

A free instance that has slept takes about a minute to wake; the web app says so meanwhile. On
the very first deploy the API can fail once while the web app does not exist yet (its address is
needed for the allowed origin); Render retries it once the web app is live.

## Risk rules

The risk engine classifies a checkpoint from its wind, rain, snow and the load weight. Try it:

```bash
cd backend
uv run python manage.py assess_risk --wind 40 --rain 0.3 --load 42000
```

How levels, route scores and the ranking work is described in [docs/risk-model.md](docs/risk-model.md).

## API

| Method | Path                  | Description                                                                   |
| ------ | --------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/health`         | Liveness check: `status`, `version`, `time`                                   |
| GET    | `/api/places/suggest` | Place suggestions while typing an origin or destination                       |
| POST   | `/api/routes`         | Three truck routes with weather risk at each checkpoint, and a recommendation |

Request and response formats, validation rules and errors: [docs/api.md](docs/api.md).
Routing needs a TomTom API key in `backend/.env` (`TOMTOM_API_KEY`); see `backend/.env.example`.
Weather comes from Open-Meteo, which needs no key.

## Limitations

- Trips can start and end anywhere TomTom has truck routing, up to 3,500 miles apart. Units are
  US customary everywhere (miles, mph, inches, pounds), as in the specification. Very long trips
  (2,000 miles or more) can take up to about 20 seconds to plan; most trips take 3 to 5.
- Open-Meteo's free tier allows 600 calls a minute and 10,000 a day, counted per location. A
  cross-country trip needs about 70 checkpoint locations at 50 mile spacing, 140 at 25 miles and
  350 at 10 miles, plus up to 120 heatmap cells, so the hosted demo handles two new trips a
  minute and roughly 38 new default trips a day. A trip planned beyond that comes back without
  its heatmap, or says the weather service is busy. Repeated trips are served from a one hour
  cache.
- Heatmap cells grow with the trip, from 20 km on short trips to about 135 km across the
  country, so local weather on a long trip is averaged over a large square. The checkpoints,
  which decide the recommendation, are not affected.

## Project structure

```
render.yaml          Render Blueprint: the API web service and the static web app
backend/
  config/            Django project: settings (base, dev, prod, test), URLs, WSGI
  gunicorn.conf.py   Production server settings
  routing/           API application: views, URL routes, management commands
  routing/risk/      Risk engine: thresholds, load rules, route scoring and ranking
  routing/clients/   TomTom (suggestions, places, geocoding, truck routing) and Open-Meteo clients
  routing/services/  Trip planning: places, route options, checkpoints, weather, heatmap,
                     recommendation
  tests/             pytest suite
frontend/
  src/app/              Application layout: side panel on wide screens, bottom sheet on phones
  src/components/       Shared interface components (header, bottom sheet, attribution)
  src/features/trip/    Trip form, place suggestions, validation, planning state
  src/features/results/ Recommendation, route cards, risky checkpoints, checkpoint details
  src/features/map/     Map view (MapLibre GL): routes and checkpoints coloured by risk
  src/features/heatmap/ Corridor heatmap expressions, forecast timeline, truck position
  src/hooks/            React hooks
  src/lib/              API client, types, formatting, risk scale
  src/styles/           Design tokens and global styles
  e2e/                  Playwright end-to-end tests (desktop and phone)
docs/
  screenshots/       Screenshots used in this README
  architecture.md    How the API and web app fit together, and how they are hosted
  decisions.md       How the specification was interpreted, and why
  risk-model.md      Risk levels, route scoring and ranking, with examples
  api.md             API endpoints, request and response formats, errors
```

## Documentation

- [Architecture](docs/architecture.md): how the API and the web app are built and hosted.
- [API](docs/api.md): endpoints, request and response formats, validation and errors.
- [Risk model](docs/risk-model.md): how weather and load become risk levels, and how routes are ranked.
- [Design decisions](docs/decisions.md): interpretation of the specification and technical choices.

## License

[MIT](LICENSE)
