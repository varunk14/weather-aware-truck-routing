/** A MediaQueryList for tests, since jsdom has no media queries. */
export function mediaQueryList(
  query: string,
  matches: () => boolean,
  listeners = new Set<() => void>(),
): MediaQueryList {
  return {
    get matches() {
      return matches();
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
    // The deprecated addListener/removeListener are left out; nothing here uses them.
  } as unknown as MediaQueryList;
}
