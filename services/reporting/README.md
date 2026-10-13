# Reporting Service

The Reporting service turns raw and enriched findings into useful output for users, dashboards, and external integrations.

## Responsibilities

- aggregate findings across scans and projects
- generate summary reports and security overviews
- publish dashboard-ready data
- prepare markdown, JSON, and UI-friendly output
- support CI/CD and external workflow integrations
- surface project posture and historical trends

## Design goal

This service is the presentation and delivery layer of the platform. It consumes the work of the Scan and AI services and packages it in a human-friendly and actionable form.

## Typical endpoints

- GET /projects/{id}/reports
- GET /reports/{report_id}
- POST /reports/generate
- GET /dashboard/summary

## Integration points

- reads scan and enrichment data from other backend services
- provides results to the web app and VS Code extension
- can integrate with CI/CD systems and external reporting pipelines

## Notes

This service should focus on communication, presentation, and delivery, not on detection or enforcement.
