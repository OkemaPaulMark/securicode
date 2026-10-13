# Securicode

Securicode is an AI-powered secure code review platform for identifying, understanding, prioritizing, and fixing security issues in software projects.

## Platform direction

The platform is organized around five backend services:

1. Gateway — authentication, request routing, and API entry point
2. Project — project metadata, repos, uploads, and lifecycle state
3. Scan — deterministic security scanning and raw finding generation
4. AI — agentic reasoning, remediation guidance, and trust-aware enrichment
5. Reporting — dashboards, summaries, and external integration output

The web app and VS Code extension are client applications that call these services; they are not part of the backend service set.

## Architecture principles

- Deterministic scanners provide the evidence.
- AI enriches, explains, and prioritizes that evidence.
- Frontends are thin consumers of backend APIs.
- Security findings must be structured, traceable, and reviewable.
- The platform is designed for shift-left security workflows.

## Repository layout

```text
securicode/
├── apps/
│   ├── web/
│   └── vscode-extension/
├── services/
│   ├── gateway/
│   ├── project/
│   ├── scan/
│   ├── ai/
│   └── reporting/
├── shared/
│   ├── schemas/
│   ├── events/
│   └── utils/
├── infra/
│   └── docker/
├── docs/
├── README.md
├── Makefile
├── .gitignore
└── LICENSE
```

## Current status

This repository is currently a clean starter structure for the platform architecture. The prototype folders from the earlier single-project approach have been removed and the codebase now reflects the final service-oriented model.

## Team ownership model

Each backend service is intended to have a single owner:

- Gateway: developer 1
- Project: developer 2
- Scan: developer 3
- AI: developer 4
- Reporting: developer 5

This keeps responsibilities clear and avoids duplicated logic across the platform.

## Getting started

```bash
cd securicode
make up
```

The local environment is configured for the shared backend services and infrastructure dependencies. Further implementation should proceed service-by-service.
