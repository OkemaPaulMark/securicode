import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* ignore */ }
});

// jsdom has no matchMedia or scrollIntoView
if (!window.matchMedia) {
  window.matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }) as MediaQueryList;
}
Element.prototype.scrollIntoView ??= function () {};
