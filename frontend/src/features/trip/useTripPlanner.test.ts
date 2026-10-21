import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, planTrip } from "../../lib/api";
import { toDatetimeLocal } from "../../lib/format";
import type { TripPlan } from "../../lib/types";
import { tripPlan } from "../../test/fixtures";
import type { TripDraft } from "./tripDraft";
import { useTripPlanner } from "./useTripPlanner";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  planTrip: vi.fn(),
}));

interface Deferred {
  resolve: (plan: TripPlan) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
}

/** Makes every planTrip call wait until the test settles it. */
function deferPlans(): Deferred[] {
  const calls: Deferred[] = [];
  vi.mocked(planTrip).mockImplementation(
    (_trip, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ resolve, reject, signal });
      }),
  );
  return calls;
}

function validDraft(): TripDraft {
  return {
    origin: { text: "Seattle, WA" },
    destination: { text: "Salt Lake City, UT" },
    departure: toDatetimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    load: "42000",
    interval: 25,
  };
}

function setUp() {
  const hook = renderHook(() => useTripPlanner());
  act(() => {
    hook.result.current.change(validDraft(), "origin");
  });
  return hook;
}

afterEach(() => {
  vi.mocked(planTrip).mockReset();
});

describe("useTripPlanner", () => {
  it("goes from idle to loading to the plan", async () => {
    const calls = deferPlans();
    const { result } = setUp();
    expect(result.current.state.status).toBe("idle");

    act(() => {
      expect(result.current.submit()).toBe(true);
    });
    expect(result.current.state.status).toBe("loading");
    expect(result.current.state.startedAt).toEqual(expect.any(Number));

    const plan = tripPlan();
    await act(async () => {
      calls[0]?.resolve(plan);
      await Promise.resolve();
    });
    expect(result.current.state).toMatchObject({ status: "success", plan, error: null });
  });

  it("ignores an older answer once a newer trip has been asked for", async () => {
    const calls = deferPlans();
    const { result } = setUp();

    act(() => {
      result.current.submit();
    });
    act(() => {
      result.current.submit();
    });
    expect(calls[0]?.signal?.aborted).toBe(true);

    const newer = tripPlan({ load_lb: 1 });
    await act(async () => {
      calls[1]?.resolve(newer);
      calls[0]?.resolve(tripPlan());
      await Promise.resolve();
    });
    expect(result.current.state.plan).toBe(newer);
  });

  it("goes back to the previous plan when a new request is cancelled", async () => {
    const calls = deferPlans();
    const { result } = setUp();
    const first = tripPlan();

    act(() => {
      result.current.submit();
    });
    await act(async () => {
      calls[0]?.resolve(first);
      await Promise.resolve();
    });
    act(() => {
      result.current.submit();
    });
    act(() => {
      result.current.cancel();
    });

    expect(calls[1]?.signal?.aborted).toBe(true);
    expect(result.current.state).toMatchObject({ status: "success", plan: first });
  });

  it("reports API errors and can retry the same trip", async () => {
    const calls = deferPlans();
    const { result } = setUp();

    act(() => {
      result.current.submit();
    });
    await act(async () => {
      calls[0]?.reject(new ApiError("No truck route connects these places.", 422));
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error?.message).toBe("No truck route connects these places.");

    act(() => {
      result.current.retry();
    });
    expect(result.current.state.status).toBe("loading");
    expect(vi.mocked(planTrip).mock.calls[1]?.[0]).toEqual(vi.mocked(planTrip).mock.calls[0]?.[0]);
  });

  it("shows a 400 that names no field on the form, so it is never silent", async () => {
    vi.mocked(planTrip).mockRejectedValue(new ApiError("JSON parse error.", 400));
    const { result } = setUp();

    act(() => {
      result.current.submit();
    });

    await waitFor(() => {
      expect(result.current.errors.form).toBe("JSON parse error.");
    });
  });

  it("tries again with the trip that failed, even after a later request was cancelled", async () => {
    const calls = deferPlans();
    const { result } = setUp();

    act(() => {
      result.current.submit();
    });
    await act(async () => {
      calls[0]?.reject(new ApiError("The weather service is not responding.", 503));
      await Promise.resolve();
    });
    const failedTrip = vi.mocked(planTrip).mock.calls[0]?.[0];

    act(() => {
      result.current.change({ ...validDraft(), load: "1000" }, "load");
    });
    act(() => {
      result.current.submit();
    });
    act(() => {
      result.current.cancel();
    });
    expect(result.current.state.status).toBe("error");

    act(() => {
      result.current.retry();
    });
    expect(vi.mocked(planTrip).mock.calls[2]?.[0]).toEqual(failedTrip);
  });

  it("turns unexpected failures into a readable error", async () => {
    vi.mocked(planTrip).mockRejectedValue(new SyntaxError("Unexpected token"));
    const { result } = setUp();

    act(() => {
      result.current.submit();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });
    expect(result.current.state.error?.message).toMatch(/Something went wrong/);
  });

  it("does not send a draft with errors", () => {
    const { result } = renderHook(() => useTripPlanner());

    act(() => {
      expect(result.current.submit()).toBe(false);
    });

    expect(planTrip).not.toHaveBeenCalled();
    expect(result.current.errors.origin).toBeDefined();
  });

  it("cancels a request still running when the planner goes away", () => {
    const calls = deferPlans();
    const { result, unmount } = setUp();

    act(() => {
      result.current.submit();
    });
    unmount();

    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});
