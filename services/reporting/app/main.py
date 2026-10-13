"""Reporting service entry point."""

from fastapi import FastAPI

app = FastAPI(title="Reporting Service")


@app.get("/health")
def health():
    return {"status": "ok"}
