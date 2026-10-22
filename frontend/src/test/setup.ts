import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { mediaQueryList } from "./media";

// jsdom has no media queries. By default nothing matches (a wide screen, no reduced motion);
// tests that need a phone layout replace this. A plain function, so mock resets keep it.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string) => mediaQueryList(query, () => false),
});

// jsdom does not lay out the page, so it has no scrollIntoView either.
Element.prototype.scrollIntoView = function scrollIntoView() {
  // Nothing to scroll in jsdom.
};

afterEach(() => {
  cleanup();
});
