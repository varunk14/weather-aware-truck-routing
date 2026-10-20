import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApiStatus } from "../../hooks/useApiStatus";
import { ApiStatusBadge } from "./ApiStatusBadge";

describe("ApiStatusBadge", () => {
  it.each<[ApiStatus, string]>([
    ["checking", "Connecting to API"],
    ["online", "API online"],
    ["offline", "API unavailable, retrying"],
  ])("announces the %s state", (status, label) => {
    render(<ApiStatusBadge status={status} />);

    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute("data-status", status);
  });
});
