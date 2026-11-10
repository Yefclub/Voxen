// Typed errors for the AI provider layer (spec 220 error codes). Messages are
// fixed English strings built by Voxen, never upstream response bodies, so a
// provider echoing a credential cannot leak it through an error.

import type { ChainProvider } from './catalog';

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'STT_NOT_CONFIGURED'
  | 'LLM_AUTH'
  | 'LLM_QUOTA'
  | 'LLM_FAILED'
  | 'TIMEOUT';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly provider: ChainProvider | null;
  readonly status: number | null;
  readonly retryable: boolean;
  /** Billed cost of every chain attempt behind this failure (spec 221). */
  costUsd: number | null = null;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { provider?: ChainProvider | null; status?: number | null; retryable?: boolean } = {},
  ) {
    super(redactSecrets(message));
    this.name = 'AiError';
    this.code = code;
    this.provider = options.provider ?? null;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Raised when the user has no usable model for a role. */
export class AiNotConfiguredError extends AiError {
  constructor(code: 'AI_NOT_CONFIGURED' | 'STT_NOT_CONFIGURED') {
    super(
      code,
      code === 'STT_NOT_CONFIGURED'
        ? 'No speech-to-text model is configured.'
        : 'No AI model is configured.',
    );
    this.name = 'AiNotConfiguredError';
  }
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|xai|pk|rk)-[A-Za-z0-9_-]{6,}/g,
  // Google API keys (Gemini): `AIza` followed by 35 URL-safe characters.
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[^\s"',;]+/gi,
  /\b(x-api-key|api[_-]?key|authorization)(["'\s:=]+)[^\s"',;]+/gi,
];

/** Removes anything shaped like a provider credential from free text. */
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let result = text;
  for (const secret of knownSecrets) {
    if (secret.length >= 8) result = result.split(secret).join('[redacted]');
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, name?: string, separator?: string) =>
      typeof name === 'string' && typeof separator === 'string'
        ? `${name}${separator}[redacted]`
        : match.toLowerCase().startsWith('bearer')
          ? 'Bearer [redacted]'
          : '[redacted]',
    );
  }
  return result;
}
