# Gateway Service

The Gateway is the public entry point for the platform. It is responsible for authenticating users, validating requests, and routing traffic to the appropriate backend service.

## Responsibilities

- user authentication and token validation
- API routing for web, VS Code extension, and other clients
- access control and authorization checks
- centralized request validation and policy enforcement
- service-to-service orchestration at the platform boundary

## Design goal

This service should remain thin and focused. It does not own scanning logic, project state, or AI reasoning; it simply protects and routes the platform.

## Typical endpoints

- POST /auth/login
- POST /auth/logout
- GET /health
- proxy or route requests to project, scan, AI, and reporting services

## Integration points

- receives requests from the web app and VS Code extension
- calls Project for project and repository operations
- calls Scan for scan orchestration
- calls AI for enriched analysis requests
- calls Reporting for summary and export requests

## Notes

This service is the API boundary for the platform and should remain stable even as backend services evolve.
