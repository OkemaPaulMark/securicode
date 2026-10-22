/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the gateway runs on :8000; the dev server proxies to it so the browser stays same-origin,
// exactly like nginx does in production (see nginx/default.conf.template).
const gateway = process.env.GATEWAY_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: gateway, changeOrigin: true },
      "/auth": { target: gateway, changeOrigin: true },
      "/docs": { target: gateway, changeOrigin: true },
      "/openapi.json": { target: gateway, changeOrigin: true },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: "jsdom", globals: true, setupFiles: ["src/test/setup.ts"] },
});
