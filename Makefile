# Starter Makefile for Securicode

.PHONY: help up down test test-gateway

help:
	@echo "Available commands:"
	@echo "  make up        Start local infrastructure"
	@echo "  make down      Stop local infrastructure"
	@echo "  make test      Run tests for all services"
	@echo "  make test-gateway  Lint + test the gateway service"

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
