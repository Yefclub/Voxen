// ============================================================================
// Capture error codes (spec 220) — stable code + localized message + action
// ============================================================================

export const CAPTURE_ERROR_CODES = [
  'INVALID_URL',
  'BLOCKED_ADDRESS',
  'UNSUPPORTED',
  'LOGIN_REQUIRED',
  'IP_BLOCKED',
  'RATE_LIMITED',
  'REMOVED',
  'NO_TEXT',
  'TOO_LARGE',
  'STT_NOT_CONFIGURED',
  'AI_NOT_CONFIGURED',
  'LLM_AUTH',
  'LLM_QUOTA',
  'LLM_FAILED',
  'WORKER_UNAVAILABLE',
  'TIMEOUT',
  'CANCELLED',
  'UNKNOWN',
] as const;

export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number];

/** What the UI should offer next. */
export type CaptureErrorAction = 'retry' | 'upload' | 'configure_ai' | 'edit_url' | 'none';

export type CaptureLocale = 'pt-BR' | 'en';

const RETRYABLE = new Set<CaptureErrorCode>(['RATE_LIMITED', 'TIMEOUT', 'WORKER_UNAVAILABLE']);

export function isCaptureErrorCode(value: unknown): value is CaptureErrorCode {
  return typeof value === 'string' && (CAPTURE_ERROR_CODES as readonly string[]).includes(value);
}

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  readonly retryable: boolean;

  constructor(code: CaptureErrorCode, detail?: string, options?: { retryable?: boolean }) {
    super(detail ?? code);
    this.name = 'CaptureError';
    this.code = code;
    this.retryable = options?.retryable ?? RETRYABLE.has(code);
  }
}

const ACTIONS: Record<CaptureErrorCode, CaptureErrorAction> = {
  INVALID_URL: 'edit_url',
  BLOCKED_ADDRESS: 'edit_url',
  UNSUPPORTED: 'upload',
  LOGIN_REQUIRED: 'upload',
  IP_BLOCKED: 'upload',
  RATE_LIMITED: 'retry',
  REMOVED: 'none',
  NO_TEXT: 'upload',
  TOO_LARGE: 'none',
  STT_NOT_CONFIGURED: 'configure_ai',
  AI_NOT_CONFIGURED: 'configure_ai',
  LLM_AUTH: 'configure_ai',
  LLM_QUOTA: 'configure_ai',
  LLM_FAILED: 'retry',
  WORKER_UNAVAILABLE: 'retry',
  TIMEOUT: 'retry',
  CANCELLED: 'retry',
  UNKNOWN: 'retry',
};

const MESSAGES: Record<CaptureLocale, Record<CaptureErrorCode, string>> = {
  'pt-BR': {
    INVALID_URL: 'Link inválido. Use um endereço http ou https completo.',
    BLOCKED_ADDRESS: 'Este endereço aponta para uma rede interna e foi bloqueado.',
    UNSUPPORTED: 'Não há como extrair conteúdo deste link ou arquivo. Envie o arquivo diretamente.',
    LOGIN_REQUIRED: 'A plataforma exige login para este conteúdo. Envie o arquivo diretamente.',
    IP_BLOCKED: 'A plataforma bloqueou o acesso automatizado do servidor. Envie o arquivo diretamente.',
    RATE_LIMITED: 'A plataforma limitou as requisições. Tente de novo em alguns minutos.',
    REMOVED: 'O conteúdo foi removido, é privado ou não existe mais.',
    NO_TEXT: 'Não encontrei texto, fala nem imagens úteis neste conteúdo.',
    TOO_LARGE: 'O conteúdo excede o limite (3 h de áudio ou 500 MB por arquivo).',
    STT_NOT_CONFIGURED:
      'STT não configurado. Adicione uma chave da OpenAI, xAI ou OpenRouter em Conta → Provedores de IA.',
    AI_NOT_CONFIGURED: 'IA não configurada. Adicione uma chave em Conta → Provedores de IA.',
    LLM_AUTH: 'O provedor de IA recusou a chave. Confira em Conta → Provedores de IA.',
    LLM_QUOTA: 'O provedor de IA está sem créditos ou cota. Recarregue e tente de novo.',
    LLM_FAILED: 'O modelo não devolveu um resultado válido. Tente de novo.',
    WORKER_UNAVAILABLE: 'O serviço de captura está indisponível. Tente de novo em instantes.',
    TIMEOUT: 'A captura demorou demais e foi interrompida. Tente de novo.',
    CANCELLED: 'Captura cancelada.',
    UNKNOWN: 'Algo deu errado na captura. Tente de novo.',
  },
  en: {
    INVALID_URL: 'Invalid link. Use a full http or https address.',
    BLOCKED_ADDRESS: 'This address points to an internal network and was blocked.',
    UNSUPPORTED: 'Content cannot be extracted from this link or file. Upload the file directly.',
    LOGIN_REQUIRED: 'The platform requires login for this content. Upload the file directly.',
    IP_BLOCKED: 'The platform blocked automated access from the server. Upload the file directly.',
    RATE_LIMITED: 'The platform rate-limited the request. Try again in a few minutes.',
    REMOVED: 'The content was removed, is private, or no longer exists.',
    NO_TEXT: 'No usable text, speech, or images were found in this content.',
    TOO_LARGE: 'The content exceeds the limit (3 h of audio or 500 MB per file).',
    STT_NOT_CONFIGURED:
      'Speech-to-text is not configured. Add an OpenAI, xAI, or OpenRouter key in Account → AI providers.',
    AI_NOT_CONFIGURED: 'AI is not configured. Add a key in Account → AI providers.',
    LLM_AUTH: 'The AI provider rejected the key. Check it in Account → AI providers.',
    LLM_QUOTA: 'The AI provider is out of credits or quota. Top up and try again.',
    LLM_FAILED: 'The model did not return a valid result. Try again.',
    WORKER_UNAVAILABLE: 'The capture service is unavailable. Try again shortly.',
    TIMEOUT: 'The capture took too long and was stopped. Try again.',
    CANCELLED: 'Capture cancelled.',
    UNKNOWN: 'Something went wrong during capture. Try again.',
  },
};

export function captureErrorMessage(code: CaptureErrorCode, locale: CaptureLocale = 'pt-BR'): string {
  return MESSAGES[locale][code];
}

export function captureErrorAction(code: CaptureErrorCode): CaptureErrorAction {
  return ACTIONS[code];
}

export function describeCaptureError(code: CaptureErrorCode, locale: CaptureLocale = 'pt-BR') {
  return {
    code,
    message: captureErrorMessage(code, locale),
    action: captureErrorAction(code),
    retryable: RETRYABLE.has(code),
  };
}
