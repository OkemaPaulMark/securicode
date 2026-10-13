"""AI Review service entry point."""

from fastapi import FastAPI

app = FastAPI(title="AI Review Service")


@app.get("/health")
def health():
    return {"status": "ok"}
