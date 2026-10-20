import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getHealth } from "./api";

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
