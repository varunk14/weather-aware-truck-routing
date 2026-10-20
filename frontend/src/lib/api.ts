const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new ApiError(
      `GET ${path} failed with status ${String(response.status)}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export interface Health {
  status: "ok";
  version: string;
  time: string;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>("/api/health", signal);
}
