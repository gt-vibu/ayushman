// Keep browser requests on the app's origin. This works for localhost and public
// HTTPS tunnels without exposing a machine-local API hostname to phones/tablets.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

// Keep practice data warm across route transitions. Mutations invalidate the
// affected practice namespace, so this improves repeat navigation without
// leaving edited records stale.
const GET_CACHE_TTL_MS = 30_000;
const SESSION_CACHE_TTL_MS = 60_000;
const GET_CACHE_MAX_ENTRIES = 200;
const getCache = new Map<string, { expiresAt: number; staleUntil: number; value?: unknown; pending?: Promise<unknown> }>();

export function peekApiCache<T>(path: string): T | null {
  const entry = getCache.get(`GET:${path}`);
  // Keep practice workspace data available briefly after it expires so route
  // changes can render immediately while the background refresh is in flight.
  // Identity and customer-private data deliberately never use stale responses.
  const staleSafe = path.startsWith('/practices/');
  return entry && entry.value !== undefined && (entry.expiresAt > Date.now() || (staleSafe && entry.staleUntil > Date.now()))
    ? entry.value as T
    : null;
}

export function invalidateApiGet(path: string) {
  getCache.delete(`GET:${path}`);
}

function cacheTtl(path: string) {
  if (/\/notifications(?:\/|\?|$)/.test(path)) return 0;
  if (path.startsWith('/customer/me') || path === '/auth/identity' || path === '/auth/me') return SESSION_CACHE_TTL_MS;
  if (/^\/public\/practices\/[^/]+(?:\?|$)/.test(path)) return 20_000;
  if (/^\/practices\/[^/]+(?:\/|\?|$)/.test(path)) return 30_000;
  return GET_CACHE_TTL_MS;
}

function pruneGetCache() {
  const now = Date.now();
  for (const [key, entry] of getCache) if (!entry.pending && entry.staleUntil <= now) getCache.delete(key);
  while (getCache.size >= GET_CACHE_MAX_ENTRIES) {
    const oldestSettled = [...getCache].find(([, entry]) => !entry.pending)?.[0];
    if (!oldestSettled) break;
    getCache.delete(oldestSettled);
  }
}

function invalidateAfterMutation(path: string) {
  // Authentication changes alter the identity attached to every cached response.
  if (path.startsWith('/auth/') || path.startsWith('/customer/login') || path.startsWith('/customer/register')) {
    getCache.clear();
    return;
  }

  // Customer profile and booking mutations affect only that customer's private views.
  if (path.startsWith('/customer/me')) {
    for (const key of getCache.keys()) if (key.startsWith('GET:/customer/me')) getCache.delete(key);
    return;
  }
  if (/^\/public\/practices\/[^/]+\/bookings/.test(path)) {
    const practiceId = path.match(/^\/public\/practices\/([^/]+)/)?.[1];
    for (const key of getCache.keys()) {
      if (key.startsWith('GET:/customer/me') || key.startsWith('GET:/public/practices/')) getCache.delete(key);
      if (practiceId && key.startsWith(`GET:/practices/${practiceId}`)) getCache.delete(key);
    }
    return;
  }
  if (path.startsWith('/customer/me/appointments/')) {
    for (const key of getCache.keys()) {
      if (key.startsWith('GET:/customer/me') || key.startsWith('GET:/practices/')) getCache.delete(key);
    }
    return;
  }

  // A practice write can invalidate related workspace data without expiring the
  // signed-in identity or unrelated customer/public data.
  const practice = path.match(/^\/practices\/[^/]+/);
  if (practice) {
    for (const key of getCache.keys()) if (key.startsWith(`GET:${practice[0]}`)) getCache.delete(key);
    const practiceId = practice[0].slice('/practices/'.length);
    getCache.delete(`GET:/public/practices/${practiceId}`);
    for (const key of getCache.keys()) if (key.startsWith('GET:/public/directory')) getCache.delete(key);
    return;
  }

  // Unknown writes are rare; invalidate conservatively to avoid stale screens.
  getCache.clear();
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const key = `${method}:${path}`;
  if (method === 'GET') {
    const cached = getCache.get(key);
    if (cached && (cached.pending || cached.expiresAt > Date.now())) {
      if (cached.pending) return cached.pending as Promise<T>;
      return cached.value as T;
    }
  }

  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const request = async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      throw new ApiError(body?.message ?? `Request failed (${response.status})`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  };

  if (method !== 'GET') {
    const result = await request();
    invalidateAfterMutation(path);
    return result;
  }

  pruneGetCache();
  const ttl = cacheTtl(path);
  const staleValue = getCache.get(key)?.value;
  const staleSafe = path.startsWith('/practices/');
  const now = Date.now();
  const entry: { expiresAt: number; staleUntil: number; value?: unknown; pending?: Promise<unknown> } = {
    expiresAt: now + ttl,
    staleUntil: now + (staleSafe ? Math.max(ttl, 5 * 60_000) : ttl),
    value: staleValue,
  };
  entry.pending = request().then((value) => {
    entry.value = value;
    entry.expiresAt = Date.now() + ttl;
    entry.staleUntil = Date.now() + (staleSafe ? Math.max(ttl, 5 * 60_000) : ttl);
    entry.pending = undefined;
    return value;
  }).catch((cause) => {
    if (entry.value !== undefined && entry.staleUntil > Date.now()) {
      entry.pending = undefined;
      entry.expiresAt = 0;
    } else {
      getCache.delete(key);
    }
    throw cause;
  });
  getCache.set(key, entry);
  return entry.pending as Promise<T>;
}

export const practicePath = (practiceId: string, suffix = '') =>
  `/practices/${encodeURIComponent(practiceId)}${suffix}`;
