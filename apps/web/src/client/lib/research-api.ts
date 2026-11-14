import { ApiError } from './api';
import type { I18nKey, TranslateFn } from './i18n';

export type ResearchMode = 'OFF' | 'MANUAL' | 'AUTO';
export interface ResearchPreferences {
  mode: ResearchMode;
  automaticSince: string | null;
  searchConfigured: boolean;
  searchLast4: string | null;
}

export function researchErrorText(error: unknown, t: TranslateFn): string {
  const body = error instanceof ApiError ? (error.body as { error?: unknown } | undefined) : null;
  const code =
    typeof body?.error === 'string' ? body.error : typeof error === 'string' ? error : '';
  const keys: Record<string, I18nKey> = {
    AI_NOT_CONFIGURED: 'research.error.model',
    WEB_NOT_CONFIGURED: 'research.error.key',
    DISABLED: 'research.error.disabled',
    REVISION_CONFLICT: 'research.error.conflict',
    STALE_RESULT: 'research.error.stale',
    RATE_LIMITED: 'research.error.rate',
    NOT_FOUND: 'research.error.missing',
  };
  return t(keys[code] ?? 'research.error.generic');
}
