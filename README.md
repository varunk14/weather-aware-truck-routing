# Clearway

[![CI](https://github.com/varunk14/weather-aware-truck-routing/actions/workflows/ci.yml/badge.svg)](https://github.com/varunk14/weather-aware-truck-routing/actions/workflows/ci.yml)

Weather-aware truck route planner. Clearway compares three routes between two places, forecasts
the weather the truck will meet at each checkpoint at its estimated arrival time, classifies the
risk from wind, rain, snow and load weight, and recommends the safest route.

> **Status:** in development. In place: the API and web app shell, tooling, CI, the risk engine
> (thresholds, load rules, route scoring and ranking), and truck routing with checkpoints and
> arrival times. Weather and the trip planner interface are added in the following milestones.

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
cp backend/.env.example backend/.env   # optional until the routing milestone
make dev
```

Open http://localhost:5173. The web app proxies `/api` to the API on http://127.0.0.1:8000.

## Commands

| Command        | What it does                                       |
| -------------- | -------------------------------------------------- |
| `make install` | Install backend and frontend dependencies          |
| `make dev`     | Run the API and the web app together               |
| `make lint`    | Lint, format-check and type-check both apps        |
| `make format`  | Format both apps                                   |
| `make test`    | Run unit and integration tests with coverage       |
| `make e2e`     | Run browser end-to-end tests                       |
| `make check`   | Run every check that CI runs                       |
| `make build`   | Build the web app for production                   |

## Risk rules

The risk engine classifies a checkpoint from its wind, rain, snow and the load weight. Try it:

```bash
cd backend
uv run python manage.py assess_risk --wind 40 --rain 0.3 --load 42000
```

How levels, route scores and the ranking work is described in [docs/risk-model.md](docs/risk-model.md).

## API

| Method | Path                  | Description                                                    |
| ------ | --------------------- | -------------------------------------------------------------- |
| GET    | `/api/health`         | Liveness check: `status`, `version`, `time`                    |
| GET    | `/api/places/suggest` | Place suggestions while typing an origin or destination        |
| POST   | `/api/routes`         | Three truck routes with checkpoints and estimated arrival times |

Request and response formats, validation rules and errors: [docs/api.md](docs/api.md).
Routing needs a TomTom API key in `backend/.env` (`TOMTOM_API_KEY`); see `backend/.env.example`.

## Project structure

```
backend/
  config/            Django project: settings (base, dev, prod, test), URLs, WSGI
  routing/           API application: views, URL routes, management commands
  routing/risk/      Risk engine: thresholds, load rules, route scoring and ranking
  routing/clients/   TomTom client (suggestions, places, geocoding, truck routing)
  routing/services/  Trip planning: places, route options, checkpoints and arrival times
  tests/             pytest suite
frontend/
  src/app/           Application shell and layout
  src/components/    Shared interface components
  src/features/map/  Map view (MapLibre GL)
  src/hooks/         React hooks
  src/lib/           API client
  src/styles/        Design tokens and global styles
  e2e/               Playwright end-to-end tests
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
