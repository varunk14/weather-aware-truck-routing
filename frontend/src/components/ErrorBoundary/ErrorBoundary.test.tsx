import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Broken({ broken }: { broken: boolean }) {
  if (broken) throw new Error("cannot render");
  return <p>Working</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("shows the fallback instead of a failed part, and recovers for a new key", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fallback = <p>Could not show this</p>;
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKey={1}>
        <Broken broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Could not show this")).toBeInTheDocument();

    rerender(
      <ErrorBoundary fallback={fallback} resetKey={2}>
        <Broken broken={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
  });
});
