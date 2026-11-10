// ============================================================================
// Availability of the keyless `local` STT provider (spec 221)
// ============================================================================
// The provider is available only while STT_LOCAL_URL is set and the
// `stt-local` sidecar answers `GET /health` with `{"status":"ok"}`; the answer
// (positive or negative) is cached per process for 30 s. STT_LOCAL_URL is
// infra config: only http(s), no credentials, no query or fragment, and it is
// never logged or returned to a client. No imports from the AI client, so key
// storage can use it without an import cycle.
// ============================================================================

export const LOCAL_STT_HEALTH_TIMEOUT_MS = 2_000;
export const LOCAL_STT_CACHE_MS = 30_000;

/**
 * Base URL of the sidecar from STT_LOCAL_URL, or null when unset or unsafe
 * (non-http(s) scheme, embedded credentials, query or fragment).
 */
export function localSttBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.STT_LOCAL_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export interface LocalSttAvailabilityDependencies {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface LocalSttAvailability {
  /** The sidecar base URL while it is available, else null. Server-only. */
  endpoint(): Promise<string | null>;
  isAvailable(): Promise<boolean>;
}

export function createLocalSttAvailability(
  dependencies: LocalSttAvailabilityDependencies = {},
): LocalSttAvailability {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  let cached: { baseUrl: string; available: boolean; expiresAt: number } | null = null;
  let pending: { baseUrl: string; promise: Promise<boolean> } | null = null;

  async function check(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(LOCAL_STT_HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
      return body?.status === 'ok';
    } catch {
      return false;
    }
  }

  async function endpoint(): Promise<string | null> {
    // Read at call time, so a changed environment takes effect without a restart.
    const baseUrl = localSttBaseUrl(dependencies.env ?? process.env);
    if (!baseUrl) return null;
    if (cached?.baseUrl === baseUrl && cached.expiresAt > now()) {
      return cached.available ? baseUrl : null;
    }
    // Concurrent callers share one health check.
    if (pending?.baseUrl !== baseUrl) {
      const promise = check(baseUrl).then((available) => {
        cached = { baseUrl, available, expiresAt: now() + LOCAL_STT_CACHE_MS };
        if (pending?.promise === promise) pending = null;
        return available;
      });
      pending = { baseUrl, promise };
    }
    return (await pending.promise) ? baseUrl : null;
  }

  return { endpoint, isAvailable: async () => (await endpoint()) !== null };
}

const defaultAvailability = createLocalSttAvailability();
export const localSttEndpoint = defaultAvailability.endpoint;
export const isLocalSttAvailable = defaultAvailability.isAvailable;
