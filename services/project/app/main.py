"""Project service entry point."""

from fastapi import FastAPI

app = FastAPI(title="Project Service")


@app.get("/health")
def health():
    return {"status": "ok"}
