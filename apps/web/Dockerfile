# ---- deps: install exactly what package-lock.json pins
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- test: type check + unit tests; the build FAILS here if anything fails (CI: --target test)
FROM deps AS test
COPY . .
RUN npm run typecheck && npm test

# ---- build: static files
FROM test AS build
RUN npm run build

# ---- runtime: unprivileged nginx serving the SPA and proxying /api to the gateway (CI: --target runtime)
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="securicode-web" org.opencontainers.image.version=${APP_VERSION}
ENV GATEWAY_URL=http://gateway:8000 NGINX_ENVSUBST_FILTER=^GATEWAY_URL$
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
