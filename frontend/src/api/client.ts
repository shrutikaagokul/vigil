/**
 * Vigil API Client
 *
 * Centralised fetch wrapper.  All API calls go through here so that:
 *   - The base URL is read from one place (VITE_API_BASE_URL env var).
 *   - Error handling & JSON parsing are uniform.
 *   - Future auth headers / interceptors are added in one spot.
 *
 * Assumption (greenfield): The backend serves a REST API at /api/*
 * with JSON responses.  When the backend is unavailable the client
 * rejects with an ApiError that UI layers can pattern-match on.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    message?: string,
  ) {
    super(message ?? `${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

/**
 * Base URL for all API requests.
 *
 * In development Vite proxies /api → localhost:8000, so you can leave
 * VITE_API_BASE_URL empty.  Set it to a full origin (e.g.
 * https://api.vigil.example.com) to point at a remote backend.
 */
const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(extraHeaders as Record<string, string> | undefined ?? {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(response.status, response.statusText, text || undefined);
  }

  // 204 No Content → return undefined cast as T
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

// ── Convenience methods ────────────────────────────────────────────
const client = {
  get:    <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'GET' }),

  post:   <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),

  patch:  <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),

  put:    <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),

  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};

export default client;
