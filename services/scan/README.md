# Scan Service

The Scan service is the evidence-producing engine of Securicode. It runs deterministic security checks, collects the raw results, and returns structured findings that the AI service can later validate and explain.

## Core responsibility

This service performs the initial discovery work. It is the first layer in the security review pipeline and must remain evidence-first and reproducible.

## Scanner stack

The initial scanner set for this service is:

- Bandit for Python security patterns
- Semgrep for rule-based source code checks
- SonarQube for broader static analysis and code-quality/security signals

Additional scanners can be added later, but the service should always normalize their output into the same finding format.

## Responsibilities

- run the required baseline scanners for each assessment
- collect scan results from Bandit, Semgrep, and SonarQube
- normalize raw scanner output into a shared JSON schema
- attach file paths, line numbers, rule IDs, severity, and evidence
- track scan execution status and scan metadata
- publish findings to the AI service for validation and interpretation
- send scan summaries to the Reporting service

## Scanner-first workflow

The platform should follow this flow:

1. the Scan service analyzes the project
2. it produces structured findings with evidence and file references
3. the AI service receives those findings as review input
4. the AI service validates whether the signal is a likely true positive, likely false positive, or needs manual review
5. the AI service explains the impact and recommends the next action

This means the scanner does the discovery work, while the AI service acts as a reviewer and analyst.

## Design goal

This service should stay deterministic, reproducible, and evidence-first. It is the operational source of truth for the raw findings in a project.

## Typical endpoints

- POST /scans
- GET /scans/{id}
- GET /scans/{id}/findings
- POST /scans/{id}/rerun

## Integration points

- receives project and repository references from the Project service
- emits raw findings to the AI service for validation and enrichment
- sends scan summaries to the Reporting service

## Notes

The AI service may explain and prioritize findings, but it should never replace the scanner as the authoritative source of the initial evidence.
