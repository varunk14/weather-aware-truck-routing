import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHealth } from "../lib/api";
import { useApiStatus } from "./useApiStatus";

vi.mock("../lib/api", () => ({ getHealth: vi.fn() }));

const getHealthMock = vi.mocked(getHealth);
const healthy = { status: "ok", version: "0.1.0", time: "2026-10-20T12:00:00+00:00" } as const;

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getHealthMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useApiStatus", () => {
  it("starts as checking and becomes online when the API answers", async () => {
    getHealthMock.mockResolvedValue(healthy);

    const { result } = renderHook(() => useApiStatus());
    expect(result.current).toBe("checking");

    await flush();
    expect(result.current).toBe("online");
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("says the API is starting up while it fails or answers slowly at first", async () => {
    getHealthMock.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValue(healthy);
    const { result } = renderHook(() => useApiStatus(1_000));

    await flush(3_900);
    expect(result.current).toBe("checking");
    await flush(200);
    expect(result.current).toBe("waking");
  });

  it("keeps saying starting up for failures inside the wake window, then offline", async () => {
    getHealthMock.mockRejectedValue(new Error("unreachable"));
    const { result } = renderHook(() => useApiStatus(1_000, 10_000));

    await flush();
    expect(result.current).toBe("waking");
    await flush(11_000);
    expect(result.current).toBe("offline");
  });

  it("reports offline and retries until the API answers", async () => {
    getHealthMock.mockRejectedValueOnce(new Error("unreachable")).mockResolvedValue(healthy);

    const { result } = renderHook(() => useApiStatus(1_000, 0));

    await flush();
    expect(result.current).toBe("offline");

    await flush(1_000);
    expect(result.current).toBe("online");
    expect(getHealthMock).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once unmounted", async () => {
    getHealthMock.mockRejectedValue(new Error("unreachable"));

    const { unmount } = renderHook(() => useApiStatus(1_000));
    await flush();
    unmount();
    await flush(5_000);

    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });
});
