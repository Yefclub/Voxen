import type { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getSettings } from '../settings';

export type ChatModelConfig = {
  apiKey: string;
  model: string;
  fallbackModel: string | null;
};

export function normalizeOpenRouterError(error: unknown): string {
  if (!(error instanceof Error)) return 'Falha inesperada ao gerar a resposta.';
  const status =
    (error as Error & { statusCode?: number; status?: number }).statusCode ??
    (error as Error & { status?: number }).status;
  if (status === 429 || /(?:provider returned 429|rate.?limit|http\s*429)/i.test(error.message)) {
    return 'O provedor atingiu um limite temporário. Tente novamente em instantes.';
  }
  if (status === 401 || status === 403) {
    return 'A OpenRouter recusou a autenticação. Peça ao administrador para revisar a configuração.';
  }
  if (status === 402) {
    return 'A conta da OpenRouter não possui créditos suficientes para gerar esta resposta.';
  }
  if (status === 408 || (typeof status === 'number' && status >= 500)) {
    return 'O provedor está temporariamente indisponível. Tente novamente em instantes.';
  }
  if (status === 400 || (typeof status === 'number' && status >= 400)) {
    return 'A OpenRouter recusou a solicitação. Peça ao administrador para revisar o modelo configurado.';
  }
  if (error.message === 'Conclua a configuração da OpenRouter em Configurações.') {
    return error.message;
  }
  return 'Falha inesperada ao gerar a resposta.';
}

export async function getChatModelConfig(): Promise<ChatModelConfig> {
  const settings = await getSettings([
    'openrouter_api_key',
    'default_chat_model',
    'fallback_chat_model',
  ] as const);
  const apiKey = settings.openrouter_api_key;
  const model = settings.default_chat_model;
  if (!apiKey || !model) {
    throw new Error('Conclua a configuração da OpenRouter em Configurações.');
  }
  const fallbackModel =
    settings.fallback_chat_model && settings.fallback_chat_model !== model
      ? settings.fallback_chat_model
      : null;
  return { apiKey, model, fallbackModel };
}

export function routedChatModel(
  provider: ReturnType<typeof createOpenRouter>,
  config: ChatModelConfig,
) {
  return provider(
    config.model,
    config.fallbackModel ? { extraBody: { models: [config.fallbackModel] } } : undefined,
  );
}
