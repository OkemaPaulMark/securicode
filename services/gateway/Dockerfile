# ---- base: runtime deps + app code
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app

# ---- test: lint + unit tests; the build FAILS here if any test fails (CI: --target test)
FROM base AS test
COPY requirements-dev.txt pyproject.toml ./
RUN pip install -r requirements-dev.txt
COPY tests ./tests
RUN ruff check app tests && pytest -q

# ---- runtime: what gets deployed (CI: --target runtime)
FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} DATABASE_URL=sqlite:////data/gateway.db
RUN useradd --system --uid 10001 appuser && mkdir /data && chown appuser /data
USER appuser
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
