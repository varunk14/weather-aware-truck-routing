import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no media queries. By default nothing matches (a wide screen, no reduced motion);
// tests that need a phone layout replace this. A plain function, so mock resets keep it.
function noMediaMatches(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
    // The deprecated addListener/removeListener are left out; nothing here uses them.
  } as unknown as MediaQueryList;
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: noMediaMatches,
});

afterEach(() => {
  cleanup();
});
