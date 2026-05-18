// ============================================================================
// Estimativa de tokens — espelho de apps/chat/src/token_limits.py
// ============================================================================
// Usado pra popular o ContextBar do Topbar IMEDIATAMENTE ao carregar uma
// conversa existente (sem esperar o user mandar nova mensagem que dispara
// o SSE `context_usage` do chat service).
//
// Estratégia: ~4 chars = 1 token (BPE em PT-BR/EN converge perto disso).
// Não é exato, mas guia bem a barra de progresso.
// ============================================================================

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  'openai/gpt-4o': 128_000,
  'openai/gpt-4o-mini': 128_000,
  'openai/gpt-4-turbo': 128_000,
  'openai/o1': 128_000,
  'openai/o1-mini': 128_000,
  'openai/o3-mini': 200_000,
  // Anthropic
  'anthropic/claude-3.5-sonnet': 200_000,
  'anthropic/claude-3.5-haiku': 200_000,
  'anthropic/claude-3-opus': 200_000,
  'anthropic/claude-opus-4': 200_000,
  'anthropic/claude-sonnet-4': 1_000_000,
  // Google
  'google/gemini-2.5-pro': 2_000_000,
  'google/gemini-2.0-flash': 1_000_000,
  'google/gemini-3.1-flash': 1_000_000,
  'google/gemini-3.1-flash-lite': 1_000_000,
  'google/gemini-pro-1.5': 2_000_000,
  // Meta
  'meta-llama/llama-3.3-70b-instruct': 128_000,
  'meta-llama/llama-3.1-405b-instruct': 128_000,
  // Mistral
  'mistralai/mistral-large': 128_000,
  'mistralai/mixtral-8x22b-instruct': 65_536,
  // DeepSeek
  'deepseek/deepseek-r1': 64_000,
  'deepseek/deepseek-chat': 64_000,
};

const DEFAULT_LIMIT = 32_000;

export function getContextLimit(model: string | null): number {
  if (!model) return DEFAULT_LIMIT;
  const base = model.split(':')[0] ?? model;
  return MODEL_CONTEXT_LIMITS[base] ?? DEFAULT_LIMIT;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.floor(text.length / 4));
}

export function estimateMessagesTokens(contents: string[]): number {
  let total = 0;
  for (const c of contents) {
    total += estimateTokens(c);
    total += 4; // overhead por mensagem (role + delimitadores)
  }
  return total;
}
