# Project Service

The Project service owns repositories, project metadata, and the lifecycle of a security assessment.

## Responsibilities

- create, update, and delete projects
- store repository metadata and source links
- manage uploaded zip files or connected repository references
- track project scan history and status
- expose project details to the web app, extension, and gateway

## Design goal

This service is the source of project state but should not contain the scanning engine or AI analysis logic. Its role is to coordinate and persist the project context that the other services need.

## Typical endpoints

- POST /projects
- GET /projects/{id}
- GET /projects/{id}/scans
- POST /projects/{id}/sync
- DELETE /projects/{id}

## Integration points

- receives project creation requests from the Gateway
- triggers scan workflows in the Scan service
- provides project context to AI and Reporting services

## Notes

This service should be the canonical owner of project lifecycle and repository metadata for the platform.
