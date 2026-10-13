# Starter Makefile for Securicode

.PHONY: help up down test

help:
	@echo "Available commands:"
	@echo "  make up        Start local infrastructure"
	@echo "  make down      Stop local infrastructure"
	@echo "  make test      Run tests for all services"

up:
	@echo "Starting local environment..."
	@docker compose -f infra/docker/docker-compose.yml up -d

down:
	@echo "Stopping local environment..."
	@docker compose -f infra/docker/docker-compose.yml down

test:
	@echo "Running tests..."
	@pytest -q
