# Web App

The web app is the browser-based user interface for Securicode.

## Responsibilities

- authenticate users
- manage projects and repository views
- display findings by severity, file, and category
- present AI explanations and recommended remediation
- expose dashboard and reporting summaries

## Important boundary

This app does not own the security logic. It interacts with the backend services through the Gateway and consumes their data.

## Notes

This is a client application, not a microservice.
