import { readFileSync } from "node:fs";

import { expect, type Page, type Route, test } from "@playwright/test";

// A real plan recorded from the API (TomTom routes, Open-Meteo forecast): Seattle to Salt Lake
// City, 42,000 lb, every 25 mi. Route B is recommended; Route A has High rain at mile 450. Its
// heatmap was added by hand: 0.5 degree cells along the routes, Moderate wind east of 118 W
// from 10 to 20 hours after departure.
const PLAN: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/plan-seattle-salt-lake-city.json", import.meta.url), "utf8"),
);

const SUGGESTIONS: Record<string, { id: string; type: string; title: string; subtitle: string }[]> =
  {
    seattle: [{ id: "sea", type: "areas", title: "Seattle, WA", subtitle: "United States" }],
    salt: [{ id: "slc", type: "areas", title: "Salt Lake City, UT", subtitle: "United States" }],
  };

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function mockApi(page: Page, routes: (route: Route) => Promise<void>) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", version: "0.1.0", time: new Date().toISOString() } }),
  );
  await page.route("**/api/places/suggest**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const key = Object.keys(SUGGESTIONS).find((name) => query.startsWith(name.slice(0, 3)));
    return route.fulfill({ json: { results: key ? SUGGESTIONS[key] : [] } });
  });
  await page.route("**/api/routes", routes);
}

async function fillTrip(page: Page) {
  await page.getByRole("combobox", { name: "Origin" }).fill("Seattle");
  await page.getByRole("option", { name: /Seattle, WA/ }).click();
  await page.getByRole("combobox", { name: "Destination" }).fill("Salt Lake");
  await page.getByRole("option", { name: /Salt Lake City, UT/ }).click();
  await page.getByRole("textbox", { name: "Load weight (lb)" }).fill("42,000");
}

/** On a phone the route cards sit below the peek position of the sheet; bring them up. */
async function showRoutes(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Show more of the trip panel" }).click();
}

test("plans a trip and recommends the safest route", async ({ page, isMobile }) => {
  const errors = collectConsoleErrors(page);
  const requests: unknown[] = [];
  await mockApi(page, (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: PLAN });
  });
  await page.goto("/");

  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();

  const recommendation = page.getByRole("region", { name: /^Route B · / });
  await expect(recommendation).toContainText("Avoids 50 mi of High-risk weather");
  expect(requests).toEqual([
    expect.objectContaining({
      origin: { place_id: "sea", place_type: "areas" },
      destination: { place_id: "slc", place_type: "areas" },
      load_lb: 42_000,
      interval_mi: 25,
    }),
  ]);

  await showRoutes(page, isMobile);
  const cards = page.getByRole("button", { name: /^Route [ABC], / });
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAccessibleName("Route B, recommended");
  await expect(page.getByRole("region", { name: "Route map" })).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 20_000 },
  );
  expect(errors).toEqual([]);
});

test("shows the forecast at a risky checkpoint", async ({ page, isMobile }) => {
  await mockApi(page, (route) => route.fulfill({ json: PLAN }));
  await page.goto("/");
  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();
  await expect(page.getByRole("region", { name: /^Route B · / })).toBeVisible();

  await showRoutes(page, isMobile);
  await page.getByRole("button", { name: /^Route A, / }).click();
  await showRoutes(page, isMobile);
  const hazards = page.getByRole("region", { name: "Weather risk on Route A" });
  await hazards.getByRole("button").first().click();

  const details = page.getByRole("region", { name: "Route A · mile 450" });
  await expect(details).toBeVisible();
  await expect(details.getByRole("row", { name: /Rain/ })).toContainText("High");
  // On a phone the details card takes the top of the map, so the timeline makes way for it.
  const timeline = page.getByRole("region", { name: "Forecast timeline" });
  if (isMobile) await expect(timeline).toBeHidden();
  else await expect(timeline).toBeVisible();
  await details.getByRole("button", { name: "Close checkpoint details" }).click();
  await expect(details).toBeHidden();
  await expect(timeline).toBeVisible();
});

test("explains when no truck route connects the places", async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({ status: 422, json: { detail: "No truck route connects these places." } }),
  );
  await page.goto("/");
  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();

  await expect(page.getByRole("alert")).toContainText("No truck route connects these places.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeHidden();
});

test("shows the API's field messages on the form", async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({
      status: 400,
      json: { destination: ["The origin and destination are the same place."] },
    }),
  );
  await page.goto("/");
  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();

  await expect(page.getByText("The origin and destination are the same place.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Destination" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("can cancel a slow plan", async ({ page }) => {
  await mockApi(page, () => new Promise<void>(() => undefined));
  await page.goto("/");
  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();

  await expect(page.getByRole("heading", { name: "Planning three truck routes" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "Planning three truck routes" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Plan routes" })).toBeEnabled();
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "The bottom sheet is the phone layout.");

  test("keeps the map in view with the plan in a sheet that can be expanded", async ({ page }) => {
    await mockApi(page, (route) => route.fulfill({ json: PLAN }));
    await page.goto("/");
    const sheet = page.getByRole("region", { name: "Trip" });
    await expect(sheet).toHaveAttribute("data-snap", "full");

    await fillTrip(page);
    await page.getByRole("button", { name: "Plan routes" }).click();

    await expect(sheet).toHaveAttribute("data-snap", "peek");
    await expect(sheet.getByText(/Seattle, WA/)).toBeVisible();
    // At peek the sheet leaves most of the screen to the map (polled: the height animates).
    const screenHeight = page.viewportSize()?.height ?? 0;
    await expect
      .poll(async () => (await sheet.boundingBox())?.height ?? Infinity)
      .toBeLessThan(screenHeight * 0.45);

    await page.getByRole("button", { name: "Show more of the trip panel" }).click();
    await expect(sheet).toHaveAttribute("data-snap", "half");
    await page.getByRole("button", { name: /^Route C, / }).click();
    await expect(sheet).toHaveAttribute("data-snap", "peek");
  });

  test("gives every button a touch target of at least 44 px", async ({ page }) => {
    await mockApi(page, (route) => route.fulfill({ json: PLAN }));
    await page.goto("/");
    await fillTrip(page);
    await page.getByRole("button", { name: "Plan routes" }).click();
    await expect(page.getByRole("region", { name: /^Route B · / })).toBeVisible();
    await page.getByRole("button", { name: "Show more of the trip panel" }).click();

    const buttons = page.getByRole("region", { name: "Trip" }).getByRole("button");
    // Every laid-out button in the sheet, including those scrolled below the fold.
    const sizes = await buttons.evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0)
        .map((box) => Math.min(box.width, box.height)),
    );
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
  });

  test("gives the forecast timeline touch targets of at least 44 px", async ({ page }) => {
    await mockApi(page, (route) => route.fulfill({ json: PLAN }));
    await page.goto("/");
    await fillTrip(page);
    await page.getByRole("button", { name: "Plan routes" }).click();

    const timeline = page.getByRole("region", { name: "Forecast timeline" });
    await expect(timeline).toBeVisible();
    const sizes = await timeline
      .getByRole("button")
      .evaluateAll((elements) =>
        elements.map((element) => Math.round(element.getBoundingClientRect().height)),
      );
    expect(sizes).toHaveLength(5);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
    const slider = await timeline.getByRole("slider").boundingBox();
    expect(Math.round(slider?.height ?? 0)).toBeGreaterThanOrEqual(44);
  });

  test("gives every day and time in the calendar a touch target of at least 44 px", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Departure / }).click();
    const calendar = page.getByRole("dialog", { name: "Choose the departure" });
    await expect(calendar).toBeVisible();

    const sizes = await calendar
      .locator("button")
      .evaluateAll((elements) =>
        elements.map((element) => Math.round(element.getBoundingClientRect().height)),
      );
    expect(sizes.length).toBeGreaterThan(30);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
  });
});

test("scrubs the 48 hour forecast without asking the network", async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ json: PLAN }));
  await page.goto("/");
  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();

  const timeline = page.getByRole("region", { name: "Forecast timeline" });
  await expect(timeline).toContainText("Thu, Oct 22, 08:00");
  await expect(timeline).toContainText("+0 h");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && !request.url().includes("/api/health")) {
      requests.push(request.url());
    }
  });

  const slider = timeline.getByRole("slider", { name: "Forecast hours after departure" });
  for (const hours of ["6", "12.5", "30", "48", "0"]) await slider.fill(hours);
  await slider.fill("6");
  await expect(timeline).toContainText("Thu, Oct 22, 14:00");
  await expect(timeline).toContainText("+6 h");
  await expect(timeline).toContainText(/Route B · truck at mile \d+ · arrives at \+[\d.]+ h/);
  await slider.fill("48");
  await expect(timeline).toContainText(/Route B arrived at \+[\d.]+ h/);

  await timeline.getByRole("button", { name: "Wind" }).click();
  await expect(timeline.getByRole("img", { name: /^Wind scale: .* mph$/ })).toBeVisible();
  await timeline.getByRole("button", { name: "Play the next 48 hours" }).click();
  await expect(timeline.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(timeline).not.toContainText("+0 h");

  expect(requests).toEqual([]);
});

test("never scrolls sideways once a plan is shown", async ({ page }) => {
  await mockApi(page, (route) => route.fulfill({ json: PLAN }));
  await page.goto("/");
  await fillTrip(page);
  await page.getByRole("button", { name: "Plan routes" }).click();
  await expect(page.getByRole("region", { name: /^Route B · / })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
