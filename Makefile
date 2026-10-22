# Starter Makefile for Securicode

.PHONY: help up down test test-gateway test-web web-dev

help:
	@echo "Available commands:"
	@echo "  make up        Start local infrastructure"
	@echo "  make down      Stop local infrastructure"
	@echo "  make test      Run tests for all services"
	@echo "  make test-gateway  Lint + test the gateway service"
	@echo "  make test-web  Type check, test and build the web app"
	@echo "  make web-dev   Run the web app on :5173 against a gateway on :8000"

up:
	@echo "Starting local environment..."
	@docker compose -f infra/docker/docker-compose.yml up -d

down:
	@echo "Stopping local environment..."
	@docker compose -f infra/docker/docker-compose.yml down

test:
	@echo "Running tests..."
	@pytest -q

test-gateway:
	@cd services/gateway && pip install -q -r requirements.txt -r requirements-dev.txt && ruff check app tests && pytest -q

test-web:
	@cd apps/web && npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build

web-dev:
	@cd apps/web && npm install --no-audit --no-fund && npm run dev
