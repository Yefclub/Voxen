// Maps provider and AI SDK failures to typed, secret-free AiErrors (spec 220).

import { APICallError } from 'ai';
import type { ChainProvider } from './catalog';
import type { ResolvedRole } from './client';
import { AiError, redactSecrets } from './errors';

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const QUOTA_PATTERN = /quota|billing|credit|insufficient|payment|balance|exceeded your/i;

/** Maps any provider/SDK failure to a typed, secret-free AiError. */
export function toAiError(error: unknown, resolved: Pick<ResolvedRole, 'provider' | 'apiKey'>) {
  if (error instanceof AiError) return error;
  const provider = resolved.provider;
  if (isAbortLike(error)) {
    return new AiError('TIMEOUT', 'The provider call was aborted or timed out.', { provider });
  }
  const lastError =
    typeof error === 'object' && error !== null && 'lastError' in error
      ? (error as { lastError: unknown }).lastError
      : undefined;
  if (lastError !== undefined && lastError !== error) return toAiError(lastError, resolved);

  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? null;
    if (status === 401 || status === 403) {
      return new AiError('LLM_AUTH', `The provider rejected the API key (HTTP ${status}).`, {
        provider,
        status,
      });
    }
    // xAI answers HTTP 400 "Incorrect API key provided" and Gemini HTTP 400
    // `API_KEY_INVALID` ("API key not valid") for a rejected key.
    if (status === 400 && isKeyRejection(provider, error.responseBody ?? '')) {
      return new AiError('LLM_AUTH', 'The provider rejected the API key (HTTP 400).', {
        provider,
        status,
      });
    }
    if (status === 402) {
      return new AiError('LLM_QUOTA', 'The provider reported insufficient credit (HTTP 402).', {
        provider,
        status,
      });
    }
    if (status === 429) {
      const quota = QUOTA_PATTERN.test(redactSecrets(error.responseBody ?? '', [resolved.apiKey]));
      return quota
        ? new AiError('LLM_QUOTA', 'The provider quota or billing limit was reached (HTTP 429).', {
            provider,
            status,
          })
        : new AiError('LLM_FAILED', 'The provider rate-limited the request (HTTP 429).', {
            provider,
            status,
            retryable: true,
          });
    }
    return new AiError(
      'LLM_FAILED',
      `The provider call failed${status ? ` (HTTP ${status})` : ''}.`,
      { provider, status, retryable: error.isRetryable },
    );
  }
  return new AiError('LLM_FAILED', 'The provider call failed.', { provider });
}

function isKeyRejection(provider: ChainProvider, body: string): boolean {
  if (provider === 'xai') return /(incorrect|invalid)[^.]{0,40}api key/i.test(body);
  if (provider === 'google') return /API_KEY_INVALID|API key not valid|API key expired/i.test(body);
  return false;
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error && isAbortLike(cause);
}
