// ============================================================================
// Curated AI model catalog (spec 220)
// ============================================================================
// Static, reviewed list of the models Voxen offers per provider and role.
// Users pick from this list only; free-form model ids are rejected. Every id
// and price below was checked against the provider source cited above each
// block on 2026-11-09 (Google: 2026-11-10). Prices are USD: text per 1M tokens, STT per minute.
// They feed cost *estimates* only; the provider invoice is authoritative.
// `reasoning` and `maxOutputTokens` of text models come from each model's
// `supported_parameters` and `top_provider.max_completion_tokens` at
// https://openrouter.ai/api/v1/models (2026-11-10), which lists the same models.
// ============================================================================

export const AI_PROVIDERS = ['openai', 'anthropic', 'openrouter', 'xai', 'google'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_ROLES = ['fast', 'standard', 'vision', 'stt'] as const;
export type AiRole = (typeof AI_ROLES)[number];
export type AiTextRole = Exclude<AiRole, 'stt'>;
export const AI_TEXT_ROLES = [
  'fast',
  'standard',
  'vision',
] as const satisfies readonly AiTextRole[];

/** Per-role reasoning effort (spec 221); speech-to-text has none. */
export const REASONING_EFFORTS = ['off', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

export interface TextPricing {
  kind: 'tokens';
  inputPerMTok: number;
  outputPerMTok: number;
  /** Higher rate applied to the whole request once the prompt exceeds the threshold. */
  longContext?: { thresholdTokens: number; inputPerMTok: number; outputPerMTok: number };
}

export interface SttPricing {
  kind: 'minutes';
  perMinute: number;
  /** Token rates, preferred when the provider reports token usage. */
  tokens?: { inputPerMTok: number; outputPerMTok: number };
}

export interface CatalogModel {
  id: string;
  label: string;
  roles: readonly AiRole[];
  vision: boolean;
  /** Context window in tokens; null for speech-to-text models. */
  contextWindow: number | null;
  /** Accepts a reasoning effort; false means no reasoning field is ever sent. */
  reasoning: boolean;
  /** Largest output (reasoning included) the model accepts; null for STT. */
  maxOutputTokens: number | null;
  pricing: TextPricing | SttPricing;
}

export interface ProviderCatalog {
  provider: AiProvider;
  label: string;
  models: readonly CatalogModel[];
  defaults: Partial<Record<AiRole, string>>;
}

const ANTHROPIC: ProviderCatalog = {
  // Sources: https://platform.claude.com/docs/en/about-claude/pricing
  //          https://platform.claude.com/docs/en/about-claude/models/overview
  provider: 'anthropic',
  label: 'Anthropic',
  models: [
    {
      id: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      roles: ['fast', 'standard', 'vision'],
      vision: true,
      contextWindow: 1_000_000,
      reasoning: true,
      maxOutputTokens: 128_000,
      pricing: {
        kind: 'tokens',
        inputPerMTok: 0.1,
        outputPerMTok: 0.5,
        longContext: { thresholdTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5 },
      },
    },
    {
      id: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      roles: ['standard', 'vision'],
      vision: true,
      contextWindow: 1_000_000,
      reasoning: true,
      maxOutputTokens: 128_000,
      pricing: { kind: 'tokens', inputPerMTok: 2, outputPerMTok: 10 },
    },
  ],
  // Anthropic offers no speech-to-text model.
  defaults: { fast: 'claude-haiku-5-5', standard: 'claude-haiku-5-5', vision: 'claude-haiku-5-5' },
};

const OPENAI: ProviderCatalog = {
  // Sources: https://developers.openai.com/api/docs/pricing
  //          https://developers.openai.com/api/docs/models
  provider: 'openai',
  label: 'OpenAI',
  models: [
    {
      id: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      roles: ['fast', 'standard', 'vision'],
      vision: true,
      contextWindow: 1_050_000,
      reasoning: true,
      maxOutputTokens: 128_000,
      pricing: {
        kind: 'tokens',
        inputPerMTok: 0.1,
        outputPerMTok: 0.5,
        longContext: { thresholdTokens: 272_000, inputPerMTok: 0.2, outputPerMTok: 0.75 },
      },
    },
    {
      id: 'gpt-6.1-terra',
      label: 'GPT-6.1 Terra',
      roles: ['standard', 'vision'],
      vision: true,
      contextWindow: 1_050_000,
      reasoning: true,
      maxOutputTokens: 128_000,
      pricing: {
        kind: 'tokens',
        inputPerMTok: 1,
        outputPerMTok: 5,
        longContext: { thresholdTokens: 272_000, inputPerMTok: 2, outputPerMTok: 7.5 },
      },
    },
    {
      id: 'gpt-transcribe',
      label: 'GPT Transcribe',
      roles: ['stt'],
      vision: false,
      contextWindow: null,
      reasoning: false,
      maxOutputTokens: null,
      pricing: { kind: 'minutes', perMinute: 0.0045 },
    },
  ],
  defaults: {
    fast: 'gpt-6-luna',
    standard: 'gpt-6-luna',
    vision: 'gpt-6-luna',
    stt: 'gpt-transcribe',
  },
};

const XAI: ProviderCatalog = {
  // Sources: https://docs.x.ai/docs/models (ids, prices, context)
  //          https://docs.x.ai/developers/model-capabilities/audio/speech-to-text (STT id)
  //          https://openrouter.ai/api/v1/models (grok-4.3 image input)
  provider: 'xai',
  label: 'xAI',
  models: [
    {
      id: 'grok-4.3',
      label: 'Grok 4.3',
      roles: ['standard', 'vision'],
      vision: true,
      contextWindow: 1_000_000,
      reasoning: true,
      maxOutputTokens: 900_000,
      pricing: {
        kind: 'tokens',
        inputPerMTok: 1.25,
        outputPerMTok: 2.5,
        longContext: { thresholdTokens: 200_000, inputPerMTok: 2.5, outputPerMTok: 5 },
      },
    },
    {
      id: 'grok-voice-transcribe-2.0',
      label: 'Grok Voice Transcribe 2.0',
      roles: ['stt'],
      vision: false,
      contextWindow: null,
      reasoning: false,
      maxOutputTokens: null,
      // $0.10 per hour on the REST endpoint.
      pricing: { kind: 'minutes', perMinute: 0.1 / 60 },
    },
  ],
  defaults: { standard: 'grok-4.3', vision: 'grok-4.3', stt: 'grok-voice-transcribe-2.0' },
};

const OPENROUTER: ProviderCatalog = {
  // Source: https://openrouter.ai/api/v1/models and
  //         https://openrouter.ai/api/v1/models?output_modalities=transcription
  // (STT prompt prices are per second of audio; converted to per minute here.)
  provider: 'openrouter',
  label: 'OpenRouter',
  models: [
    {
      id: 'anthropic/claude-haiku-5.5',
      label: 'Claude Haiku 5.5',
      roles: ['fast', 'standard', 'vision'],
      vision: true,
      contextWindow: 1_000_000,
      reasoning: true,
      maxOutputTokens: 128_000,
      pricing: { kind: 'tokens', inputPerMTok: 0.1, outputPerMTok: 0.5 },
    },
    {
      id: 'openai/gpt-6-luna',
      label: 'GPT-6 Luna',
      roles: ['fast', 'standard', 'vision'],
      vision: true,
      contextWindow: 1_050_000,
      reasoning: true,
      maxOutputTokens: 128_000,
      pricing: { kind: 'tokens', inputPerMTok: 0.1, outputPerMTok: 0.5 },
    },
    {
      id: 'deepseek/deepseek-v4.1-flash',
      label: 'DeepSeek V4.1 Flash',
      roles: ['fast', 'standard', 'vision'],
      vision: true,
      contextWindow: 1_048_576,
      reasoning: true,
      maxOutputTokens: 943_718,
      pricing: { kind: 'tokens', inputPerMTok: 0.051, outputPerMTok: 0.567 },
    },
    {
      id: 'x-ai/grok-4.3',
      label: 'Grok 4.3',
      roles: ['standard', 'vision'],
      vision: true,
      contextWindow: 1_000_000,
      reasoning: true,
      maxOutputTokens: 900_000,
      pricing: { kind: 'tokens', inputPerMTok: 1.25, outputPerMTok: 2.5 },
    },
    {
      id: 'openai/whisper-large-v3-turbo',
      label: 'Whisper Large v3 Turbo',
      roles: ['stt'],
      vision: false,
      contextWindow: null,
      reasoning: false,
      maxOutputTokens: null,
      pricing: { kind: 'minutes', perMinute: 0.0002 },
    },
    {
      id: 'openai/gpt-transcribe',
      label: 'GPT Transcribe',
      roles: ['stt'],
      vision: false,
      contextWindow: null,
      reasoning: false,
      maxOutputTokens: null,
      pricing: { kind: 'minutes', perMinute: 0.0045 },
    },
  ],
  defaults: {
    fast: 'anthropic/claude-haiku-5.5',
    standard: 'anthropic/claude-haiku-5.5',
    vision: 'anthropic/claude-haiku-5.5',
    stt: 'openai/whisper-large-v3-turbo',
  },
};

const GOOGLE: ProviderCatalog = {
  // Sources: https://aistudio.google.com/docs/pricing (Standard paid tier)
  //          https://aistudio.google.com/docs/models (ids, stability, 3.8 Flash recommended)
  //          https://aistudio.google.com/docs/models/gemini-3.5-flash-lite (context, inputs)
  //          https://aistudio.google.com/docs/models/gemini-3.8-flash (context, inputs)
  //          https://aistudio.google.com/docs/models/gemini-3.5-transcribe (audio up to 1 h)
  provider: 'google',
  label: 'Google Gemini',
  models: [
    {
      id: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash-Lite',
      roles: ['fast', 'standard', 'vision'],
      vision: true,
      contextWindow: 1_048_576,
      reasoning: true,
      maxOutputTokens: 65_536,
      pricing: { kind: 'tokens', inputPerMTok: 0.3, outputPerMTok: 2.5 },
    },
    {
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      roles: ['standard', 'vision'],
      vision: true,
      contextWindow: 1_048_576,
      reasoning: true,
      maxOutputTokens: 65_536,
      // Google lists a rise to $1.50 / $7.50 from 2027-01-01.
      pricing: { kind: 'tokens', inputPerMTok: 0.75, outputPerMTok: 3.75 },
    },
    {
      id: 'gemini-3.5-transcribe',
      label: 'Gemini 3.5 Transcribe',
      roles: ['stt'],
      vision: false,
      contextWindow: null,
      reasoning: false,
      maxOutputTokens: null,
      // $2 / 1M audio input tokens + $12 / 1M text output tokens; Google's
      // per-minute equivalent is $0.003 + $0.002, used when usage is missing.
      pricing: {
        kind: 'minutes',
        perMinute: 0.005,
        tokens: { inputPerMTok: 2, outputPerMTok: 12 },
      },
    },
  ],
  defaults: {
    fast: 'gemini-3.5-flash-lite',
    standard: 'gemini-3.5-flash-lite',
    vision: 'gemini-3.5-flash-lite',
    stt: 'gemini-3.5-transcribe',
  },
};

export const AI_CATALOG: Readonly<Record<AiProvider, ProviderCatalog>> = {
  openai: OPENAI,
  anthropic: ANTHROPIC,
  openrouter: OPENROUTER,
  xai: XAI,
  google: GOOGLE,
};

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function findCatalogModel(provider: AiProvider, modelId: string): CatalogModel | null {
  return AI_CATALOG[provider].models.find((model) => model.id === modelId) ?? null;
}

/** True when the catalog lists `modelId` for `provider` and it can serve `role`. */
export function modelServesRole(provider: AiProvider, modelId: string, role: AiRole): boolean {
  const model = findCatalogModel(provider, modelId);
  return model !== null && model.roles.includes(role);
}

export function providerDefaults(provider: AiProvider): Partial<Record<AiRole, string>> {
  return AI_CATALOG[provider].defaults;
}

/** Estimated USD cost of one text call; null when usage is unknown. */
export function estimateTextCostUsd(
  model: CatalogModel,
  usage: { inputTokens: number | undefined; outputTokens: number | undefined },
): number | null {
  if (model.pricing.kind !== 'tokens') return null;
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const long = model.pricing.longContext;
  const rates =
    long && usage.inputTokens > long.thresholdTokens
      ? long
      : { inputPerMTok: model.pricing.inputPerMTok, outputPerMTok: model.pricing.outputPerMTok };
  return roundUsd(
    (usage.inputTokens * rates.inputPerMTok + usage.outputTokens * rates.outputPerMTok) / 1_000_000,
  );
}

/**
 * Estimated USD cost of transcribing `seconds` of audio; token usage is used
 * instead when the provider reports it and the model has token rates. Null
 * when neither is known.
 */
export function estimateSttCostUsd(
  model: CatalogModel,
  seconds: number | null,
  usage?: { inputTokens: number; outputTokens: number } | null,
): number | null {
  if (model.pricing.kind !== 'minutes') return null;
  const rates = model.pricing.tokens;
  if (rates && usage) {
    return roundUsd(
      (usage.inputTokens * rates.inputPerMTok + usage.outputTokens * rates.outputPerMTok) /
        1_000_000,
    );
  }
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return roundUsd((Math.max(0, seconds) / 60) * model.pricing.perMinute);
}

function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
