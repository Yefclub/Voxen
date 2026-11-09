// Cheap authenticated probe used to validate a provider key on save/test.
// Fixed endpoints only: users cannot point Voxen at their own base URL.

import type { AiProvider } from './catalog';

export type ProbeStatus = 'valid' | 'invalid' | 'unknown';

export interface ProbeResult {
  status: ProbeStatus;
  /** Stable, secret-free reason; null when valid. */
  error: string | null;
}

export type ProbeProviderKey = (provider: AiProvider, apiKey: string) => Promise<ProbeResult>;

export const PROBE_TIMEOUT_MS = 10_000;

const PROBE_REQUESTS: Record<
  AiProvider,
  (apiKey: string) => { url: string; headers: HeadersInit }
> = {
  openai: (apiKey) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { authorization: `Bearer ${apiKey}` },
  }),
  anthropic: (apiKey) => ({
    url: 'https://api.anthropic.com/v1/models',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  }),
  xai: (apiKey) => ({
    url: 'https://api.x.ai/v1/models',
    headers: { authorization: `Bearer ${apiKey}` },
  }),
  openrouter: (apiKey) => ({
    url: 'https://openrouter.ai/api/v1/key',
    headers: { authorization: `Bearer ${apiKey}` },
  }),
};

export function createKeyProbe(fetchImpl: typeof fetch = fetch): ProbeProviderKey {
  return async (provider, apiKey) => {
    const request = PROBE_REQUESTS[provider](apiKey);
    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: 'GET',
        headers: { ...request.headers, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { status: 'unknown', error: timedOut ? 'PROBE_TIMEOUT' : 'PROBE_NETWORK' };
    }
    // The body is never read: it may echo request data and is not needed.
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { status: 'valid', error: null };
    if (response.status === 401 || response.status === 403) {
      return { status: 'invalid', error: `HTTP_${response.status}` };
    }
    return { status: 'unknown', error: `HTTP_${response.status}` };
  };
}

export const probeProviderKey: ProbeProviderKey = (provider, apiKey) =>
  createKeyProbe()(provider, apiKey);
