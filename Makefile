# Common development tasks. Run `make help` to list them.

BACKEND := backend
FRONTEND := frontend
BACKEND_ENV := $(if $(wildcard $(BACKEND)/.env),--env-file .env,)

.DEFAULT_GOAL := help
.PHONY: help install dev backend frontend lint format test e2e build check clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z0-9-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install backend and frontend dependencies
	cd $(BACKEND) && uv sync
	cd $(FRONTEND) && pnpm install

dev: ## Run the API and the web app together (Ctrl+C stops both)
	$(MAKE) -j2 backend frontend

backend: ## Run the API on http://127.0.0.1:8000
	cd $(BACKEND) && uv run $(BACKEND_ENV) python manage.py runserver 127.0.0.1:8000

frontend: ## Run the web app on http://localhost:5173
	cd $(FRONTEND) && pnpm dev

lint: ## Lint, format-check and type-check both apps
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check . && uv run mypy .
	cd $(FRONTEND) && pnpm lint && pnpm format:check && pnpm typecheck

format: ## Format both apps
	cd $(BACKEND) && uv run ruff check --fix . && uv run ruff format .
	cd $(FRONTEND) && pnpm format

test: ## Run unit and integration tests with coverage
	cd $(BACKEND) && uv run pytest --cov
	cd $(FRONTEND) && pnpm test:coverage

e2e: ## Run browser end-to-end tests
	cd $(FRONTEND) && pnpm e2e

build: ## Build the web app for production
	cd $(FRONTEND) && pnpm build

check: lint test e2e ## Run every check that CI runs

clean: ## Remove build output and tool caches
	rm -rf $(FRONTEND)/dist $(FRONTEND)/coverage $(FRONTEND)/playwright-report $(FRONTEND)/test-results
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache $(BACKEND)/.mypy_cache $(BACKEND)/htmlcov $(BACKEND)/.coverage
