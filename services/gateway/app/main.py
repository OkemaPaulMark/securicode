"""Gateway service entry point."""

from fastapi import FastAPI

app = FastAPI(title="Gateway Service")


@app.get("/health")
def health():
    return {"status": "ok"}
