const RUNTIME_ENDPOINT_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  fingerprint: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function invalidateRuntimeEndpointCache(providerId: string): void {
  cache.delete(providerId);
}

export function hasFreshRuntimeEndpointCache(
  providerId: string,
  fingerprint: string,
  now = Date.now(),
): boolean {
  const cached = cache.get(providerId);
  if (cached?.fingerprint === fingerprint && cached.expiresAt > now) return true;
  if (cached) cache.delete(providerId);
  return false;
}

export function rememberRuntimeEndpointCache(
  providerId: string,
  fingerprint: string,
  now = Date.now(),
): void {
  cache.set(providerId, {
    fingerprint,
    expiresAt: now + RUNTIME_ENDPOINT_CACHE_TTL_MS,
  });
}
