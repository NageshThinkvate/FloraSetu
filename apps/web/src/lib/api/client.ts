// Typed API client — bearer-token auth only, no cookie-only sessions (ADR-006).
const BASE_URL = import.meta.env.VITE_API_URL as string;

const STORAGE_KEY = 'florasetu.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session | null): void {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

const ORG_STORAGE_KEY = 'florasetu.activeOrg';

let activeOrgId: string | null = null;
try {
  activeOrgId = localStorage.getItem(ORG_STORAGE_KEY);
} catch {
  activeOrgId = null;
}
export function setActiveOrg(orgId: string | null): void {
  activeOrgId = orgId;
  if (orgId) {
    localStorage.setItem(ORG_STORAGE_KEY, orgId);
  } else {
    localStorage.removeItem(ORG_STORAGE_KEY);
  }
}
export function getActiveOrg(): string | null {
  return activeOrgId;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; trace_id: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const session = getSession();
  if (session) {
    headers.authorization = `Bearer ${session.accessToken}`;
  }
  if (activeOrgId) {
    headers['x-org-id'] = activeOrgId;
  }
  if (opts?.idempotencyKey) {
    headers['idempotency-key'] = opts.idempotencyKey;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(res.status, envelope?.error.code ?? 'INTERNAL_ERROR', envelope?.error.message ?? `request failed: ${res.status}`, envelope?.error.details);
  }
  // 204/empty-body success (e.g. NestJS void handlers) has no JSON to parse.
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiGet = <T>(path: string): Promise<T> => call<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T> =>
  call<T>('POST', path, body, opts);
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> => call<T>('PATCH', path, body);

export const newIdempotencyKey = (): string =>
  (crypto.randomUUID ? crypto.randomUUID() : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
