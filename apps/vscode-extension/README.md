# VS Code Extension

The VS Code extension brings Securicode directly into the developer workflow.

## Responsibilities

- scan the active file or workspace
- show findings as editor diagnostics
- link security issues to file locations
- explain risks with the AI Review service
- suggest remediation guidance before applying a fix

## Important boundary

This extension is a client application, not a backend service. It calls the shared platform APIs and surfaces the results to the developer.

## Notes

The scan and reasoning logic live in the backend services, while the extension delivers the experience inside the editor.
