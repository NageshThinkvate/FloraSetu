// Typed API client — bearer-token auth only, no cookie-only sessions (ADR-006).
const BASE_URL = import.meta.env.VITE_API_URL as string;

let bearerToken: string | null = null;

export function setBearerToken(token: string | null): void {
  bearerToken = token;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; trace_id: string; details?: Record<string, unknown> };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new Error(envelope?.error.message ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string): Promise<T> => call<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown): Promise<T> => call<T>('POST', path, body);
