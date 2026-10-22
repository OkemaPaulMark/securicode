/**
 * Chooses where each call goes.
 *  - live session: identity calls go to the gateway. Platform calls go to the gateway too, but if the gateway
 *    reports that the owning service is missing or down, the app switches to sample data and says so in a banner.
 *  - demo session ("Explore with sample data" on the sign-in page): everything is served in the browser.
 */
import { liveGateway, type GatewayApi } from "./gateway";
import { ApiError } from "./http";
import { livePlatform, type PlatformApi } from "./platform";
import { demoGateway, demoPlatform } from "../demo/store";

export type Mode = "live" | "demo";
const MODE_KEY = "securicode.mode";

let mode: Mode = readMode();
let fallback = false;
const fallbackListeners = new Set<(on: boolean) => void>();

function readMode(): Mode {
  try {
    return window.sessionStorage.getItem(MODE_KEY) === "demo" ? "demo" : "live";
  } catch {
    return "live";
  }
}

export function getMode(): Mode {
  return mode;
}

export function setMode(m: Mode): void {
  mode = m;
  fallback = false;
  try {
    if (m === "demo") window.sessionStorage.setItem(MODE_KEY, "demo");
    else window.sessionStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
  fallbackListeners.forEach((fn) => fn(false));
}

export function usingSampleData(): boolean {
  return mode === "demo" || fallback;
}

export function onFallbackChange(fn: (on: boolean) => void): () => void {
  fallbackListeners.add(fn);
  return () => fallbackListeners.delete(fn);
}

/** Try the real services again (banner action). */
export function recheckServices(): void {
  fallback = false;
  fallbackListeners.forEach((fn) => fn(false));
}

function setFallback() {
  if (!fallback) {
    fallback = true;
    fallbackListeners.forEach((fn) => fn(true));
  }
}

export const gateway: GatewayApi = new Proxy({} as GatewayApi, {
  get(_t, key: keyof GatewayApi) {
    return (...args: unknown[]) => {
      const impl = mode === "demo" ? demoGateway : liveGateway;
      return (impl[key] as (...a: unknown[]) => unknown)(...args);
    };
  },
});

export const platform: PlatformApi = new Proxy({} as PlatformApi, {
  get(_t, key: keyof PlatformApi) {
    return async (...args: unknown[]) => {
      const call = (impl: PlatformApi) => (impl[key] as (...a: unknown[]) => Promise<unknown>)(...args);
      if (mode === "demo" || fallback) return call(demoPlatform);
      try {
        return await call(livePlatform);
      } catch (err) {
        if (err instanceof ApiError && err.serviceMissing && err.status !== 0) {
          setFallback();
          return call(demoPlatform);
        }
        throw err;
      }
    };
  },
});

export { ApiError };
