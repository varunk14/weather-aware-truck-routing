import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getHealth, isAbortError, planTrip, suggestPlaces } from "./api";
import type { TripRequest } from "./types";

const healthy = { status: "ok", version: "0.1.0", time: "2026-10-20T12:00:00+00:00" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHealth", () => {
  it("requests the health endpoint and returns the parsed payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(healthy));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual(healthy);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("passes the abort signal through to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(healthy));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await getHealth(controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("throws an ApiError carrying the status code when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const error: unknown = await getHealth().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, name: "ApiError" });
  });
});

const trip: TripRequest = {
  origin: { query: "Seattle, WA" },
  destination: { place_id: "abc", place_type: "areas" },
  departure: "2026-10-22T15:00:00.000Z",
  load_lb: 42_000,
  interval_mi: 25,
};

function failWith(status: number, body?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
      ),
  );
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("planTrip", () => {
  it("posts the trip as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ routes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await planTrip(trip);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/routes");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(trip);
  });

  it("uses the API's own message when it gives one", async () => {
    failWith(422, { detail: "No truck route connects these places." });

    const error = await errorOf(planTrip(trip));

    expect(error.status).toBe(422);
    expect(error.message).toBe("No truck route connects these places.");
  });

  it("collects the first message for each invalid field, including nested ones", async () => {
    failWith(400, {
      load_lb: ["Ensure this value is less than or equal to 80000."],
      origin: {
        non_field_errors: [
          "Give exactly one of: place_id with place_type, lat with lon, or query.",
        ],
      },
    });

    const error = await errorOf(planTrip(trip));

    expect(error.message).toBe("Some details need fixing.");
    expect(error.fieldErrors).toEqual({
      load_lb: "Ensure this value is less than or equal to 80000.",
      origin: "Give exactly one of: place_id with place_type, lat with lon, or query.",
    });
  });

  it.each([
    [429, "Too many requests"],
    [500, "server ran into a problem"],
    [404, "HTTP 404"],
  ])("explains a %s without a message", async (status, text) => {
    failWith(status);

    expect((await errorOf(planTrip(trip))).message).toContain(text);
  });

  it("explains a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await errorOf(planTrip(trip));

    expect(error.status).toBe(0);
    expect(error.message).toContain("could not reach");
  });

  it("lets a cancelled request end as an abort, not an error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));

    const error: unknown = await planTrip(trip).catch((reason: unknown) => reason);

    expect(isAbortError(error)).toBe(true);
  });
});

describe("suggestPlaces", () => {
  it("asks for suggestions for the typed text and returns the results", async () => {
    const results = [{ id: "1", type: "areas", title: "Denver, CO", subtitle: "United States" }];
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(suggestPlaces("den ver&")).resolves.toEqual(results);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/places/suggest?q=den+ver%26");
  });
});
