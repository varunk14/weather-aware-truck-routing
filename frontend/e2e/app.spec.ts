import { expect, test, type Page } from "@playwright/test";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("application shell", () => {
  test("shows the brand, the empty state, a connected API and a loaded map", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.route("**/api/health", (route) =>
      route.fulfill({ json: { status: "ok", version: "0.1.0", time: new Date().toISOString() } }),
    );

    await page.goto("/");

    await expect(page).toHaveTitle(/Clearway/);
    await expect(page.getByRole("heading", { level: 1, name: "Clearway" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan a trip" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("API online");

    const map = page.getByRole("region", { name: "Route map" });
    await expect(map.locator(".maplibregl-canvas")).toBeVisible();
    // aria-busy clears only after MapLibre fires "load": style, worker and first tiles are ready.
    await expect(map).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("tells the user when the API is unreachable", async ({ page }) => {
    await page.route("**/api/health", (route) => route.fulfill({ status: 503 }));

    await page.goto("/");

    await expect(page.getByRole("status")).toHaveText("API unavailable, retrying");
  });
});
