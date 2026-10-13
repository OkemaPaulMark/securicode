# Securicode Architecture

## Overview

The platform is structured around five backend services:

1. Gateway
2. Project
3. Scan
4. AI
5. Reporting

The web app and VS Code extension are consumers of these services.

## Flow

1. User authenticates through the Gateway.
2. Project metadata and repository information are managed by the Project service.
3. A scan request is triggered against the Scan service.
4. The Scan service produces deterministic findings.
5. The AI service enriches findings with explanation, prioritization, and recommendations.
6. The Reporting service consolidates results for dashboards and external outputs.

## Communication

- REST for synchronous requests
- Message queue for asynchronous scan and AI jobs
- Shared schemas for common contracts

## Notes

This is a starter architecture for a team of five developers. It is intentionally simple and designed to support extension later.
