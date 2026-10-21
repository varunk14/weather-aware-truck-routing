import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { mediaQueryList } from "../test/media";
import { PHONE_QUERY, useMediaQuery } from "./useMediaQuery";

const defaultMatchMedia = window.matchMedia.bind(window);

afterEach(() => {
  window.matchMedia = defaultMatchMedia;
});

/** A controllable media query list, like a window being resized across the breakpoint. */
function fakeMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = (query: string) => mediaQueryList(query, () => matches, listeners);
  return {
    listeners,
    set(value: boolean) {
      matches = value;
      for (const listener of listeners) listener();
    },
  };
}

describe("useMediaQuery", () => {
  it("follows the query as the window changes and stops listening when unmounted", () => {
    const media = fakeMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery(PHONE_QUERY));
    expect(result.current).toBe(false);

    act(() => {
      media.set(true);
    });
    expect(result.current).toBe(true);

    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
