import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

vi.mock("../features/map/MapView", () => ({
  default: () => <div role="region" aria-label="Route map" />,
}));

vi.mock("../hooks/useApiStatus", () => ({
  useApiStatus: () => "online",
}));

describe("App", () => {
  it("renders the brand, the empty state, the API status and the map", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Clearway" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan a trip" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("API online");
    expect(await screen.findByRole("region", { name: "Route map" })).toBeInTheDocument();
  });

  it("lists the ranking rules in the order they are applied", () => {
    render(<App />);

    const rules = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(rules).toEqual([
      "Fewest miles in Severe weather",
      "Fewest miles in High-risk weather",
      "Lowest average risk",
      "Shortest travel time",
    ]);
  });
});
