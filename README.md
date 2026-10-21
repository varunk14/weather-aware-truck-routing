# Clearway

[![CI](https://github.com/varunk14/weather-aware-truck-routing/actions/workflows/ci.yml/badge.svg)](https://github.com/varunk14/weather-aware-truck-routing/actions/workflows/ci.yml)

Weather-aware truck route planner. Clearway compares three routes between two places, forecasts
the weather the truck will meet at each checkpoint at its estimated arrival time, classifies the
risk from wind, rain, snow and load weight, and recommends the safest route.

> **Status:** in development. In place: the risk engine, truck routing with checkpoints and arrival
> times, the weather forecast at every checkpoint, the trip planner interface (a form with place
> suggestions, the recommended route, ranked route cards, checkpoint details and the map, with a
> bottom sheet layout on phones) and the corridor weather heatmap with its 0 to 48 hour forecast
> slider and truck marker. Hosting comes next.

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
- Open-Meteo's free tier allows 10,000 calls a day, counted per location. A cross-country trip
  needs about 70 checkpoint locations at 50 mile spacing, 140 at 25 miles and 350 at 10 miles,
  plus up to 200 heatmap cells, so the hosted demo handles roughly 30 new default trips a day.
  Repeated trips are served from a 15 minute cache.
- Heatmap cells grow with the trip, from 20 km on short trips to about 100 km across the
  country, so local weather on a long trip is averaged over a large square. The checkpoints,
  which decide the recommendation, are not affected.

## Project structure

```
backend/
  config/            Django project: settings (base, dev, prod, test), URLs, WSGI
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
  decisions.md       How the specification was interpreted, and why
  risk-model.md      Risk levels, route scoring and ranking, with examples
  api.md             API endpoints, request and response formats, errors
```

## Documentation

- [API](docs/api.md): endpoints, request and response formats, validation and errors.
- [Risk model](docs/risk-model.md): how weather and load become risk levels, and how routes are ranked.
- [Design decisions](docs/decisions.md): interpretation of the specification and technical choices.

## License

[MIT](LICENSE)
