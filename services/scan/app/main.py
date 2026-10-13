"""Scan service entry point."""

from fastapi import FastAPI

app = FastAPI(title="Scan Service")


@app.get("/health")
def health():
    return {"status": "ok"}
