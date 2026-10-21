import type { Suggestion, TripPlan, TripRequest } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

/** A failed API call, with a message that can be shown to the user as it is. */
export class ApiError extends Error {
  readonly status: number;
  /** First message per request field, for a 400 that names fields. */
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      "Clearway could not reach its server. Check your connection and try again.",
      0,
    );
  }
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { headers: { Accept: "application/json" }, signal });
}

export function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function toApiError(response: Response): Promise<ApiError> {
  const status = response.status;
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && typeof body.detail === "string") {
    return new ApiError(body.detail, status);
  }
  if (status === 400 && isRecord(body)) {
    const fieldErrors: Record<string, string> = {};
    for (const [field, value] of Object.entries(body)) {
      const message = firstMessage(value);
      if (message) fieldErrors[field] = message;
    }
    return new ApiError("Some details need fixing.", status, fieldErrors);
  }
  if (status === 429) {
    return new ApiError("Too many requests. Wait a minute and try again.", status);
  }
  if (status >= 500) {
    return new ApiError("The Clearway server ran into a problem. Try again in a moment.", status);
  }
  return new ApiError(`The request failed (HTTP ${String(status)}).`, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first message in a DRF error value: a string, a list, or a nested serializer's errors. */
function firstMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const values: unknown[] = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  for (const item of values) {
    const message = firstMessage(item);
    if (message) return message;
  }
  return undefined;
}

export interface Health {
  status: "ok";
  version: string;
  time: string;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>("/api/health", signal);
}

export async function suggestPlaces(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const params = new URLSearchParams({ q: query });
  const body = await getJson<{ results: Suggestion[] }>(
    `/api/places/suggest?${params.toString()}`,
    signal,
  );
  return body.results;
}

export function planTrip(trip: TripRequest, signal?: AbortSignal): Promise<TripPlan> {
  return postJson<TripPlan>("/api/routes", trip, signal);
}
