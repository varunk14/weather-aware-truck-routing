import { expect, test } from "@playwright/test";

// Runs in every Playwright project (desktop and mobile), so each check holds on both.

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", version: "0.1.0", time: new Date().toISOString() } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Clearway" })).toBeVisible();
});

test("fits the screen without horizontal scrolling", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});

test("shows the brand and API status at the top of the screen", async ({ page }) => {
  const heading = await page.getByRole("heading", { level: 1, name: "Clearway" }).boundingBox();
  const status = await page.getByRole("status").boundingBox();

  expect(heading?.y).toBeLessThan(80);
  expect(status?.y).toBeLessThan(80);
});

test("shows zoom buttons only where there is no touch screen", async ({ page, isMobile }) => {
  const zoomIn = page.getByRole("button", { name: "Zoom in" });

  if (isMobile) {
    await expect(zoomIn).toBeHidden();
  } else {
    await expect(zoomIn).toBeVisible();
  }
});
