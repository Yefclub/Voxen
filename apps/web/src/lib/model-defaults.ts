export const DEFAULT_TEXT_MODEL = 'x-ai/grok-4.5';
export const DEFAULT_TRANSCRIPTION_MODEL = 'x-ai/grok-stt-1.0';

export const DEFAULT_OPENROUTER_MODELS = {
  default_chat_model: DEFAULT_TEXT_MODEL,
  default_transcription_model: DEFAULT_TRANSCRIPTION_MODEL,
  default_web_search_model: DEFAULT_TEXT_MODEL,
  default_vision_model: DEFAULT_TEXT_MODEL,
  default_document_model: DEFAULT_TEXT_MODEL,
  default_x_analysis_model: DEFAULT_TEXT_MODEL,
} as const;

type OpenRouterModelCapabilities = {
  id: string;
  name?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

export type ModelCompatibilityFailure = {
  purpose: ModelPurpose;
  modelId: string;
  reason: 'unavailable' | 'incompatible';
};

export function hasCanonicalOpenRouterModels(
  models: readonly OpenRouterModelCapabilities[],
): boolean {
  const textDefault = models.find((model) => model.id === DEFAULT_TEXT_MODEL);
  const transcriptionDefault = models.find((model) => model.id === DEFAULT_TRANSCRIPTION_MODEL);
  const textInputs = textDefault?.architecture?.input_modalities ?? [];
  const textOutputs = textDefault?.architecture?.output_modalities ?? [];
  const transcriptionOutputs = transcriptionDefault?.architecture?.output_modalities ?? [];

  return (
    Boolean(textDefault) &&
    textInputs.includes('text') &&
    textInputs.includes('image') &&
    textInputs.includes('file') &&
    textOutputs.includes('text') &&
    Boolean(transcriptionDefault) &&
    transcriptionOutputs.includes('transcription')
  );
}

// ============================================================================
// Seleção manual de modelos por finalidade (spec 123)
// ============================================================================
// As 6 finalidades reutilizam as MESMAS 6 chaves de Setting já usadas pelo
// contrato unificado de onboarding (spec 118). O valor persistido em cada
// chave é sempre o modelo EFETIVO (canônico ou override) — nunca fica
// ausente depois do primeiro setup. Por isso, "há override?" é decidido por
// comparação: valor armazenado !== modelo canônico daquela finalidade.
// ============================================================================

export type ModelPurpose = keyof typeof DEFAULT_OPENROUTER_MODELS;

export const MODEL_PURPOSES: readonly ModelPurpose[] = [
  'default_chat_model',
  'default_transcription_model',
  'default_web_search_model',
  'default_vision_model',
  'default_document_model',
  'default_x_analysis_model',
];

export function isModelPurpose(value: string): value is ModelPurpose {
  return (MODEL_PURPOSES as readonly string[]).includes(value);
}

export function canonicalModelForPurpose(purpose: ModelPurpose): string {
  return DEFAULT_OPENROUTER_MODELS[purpose];
}

/**
 * Compatibilidade de um modelo do catálogo OpenRouter com uma finalidade
 * específica. Espelha os filtros de modalidade que o `/api/openrouter/models`
 * (pré spec-118) aplicava por finalidade — ver histórico em
 * `apps/web/src/lib/openrouter.ts` no commit `bd26187^`.
 */
export function isModelCompatibleWithPurpose(
  purpose: ModelPurpose,
  model: OpenRouterModelCapabilities,
): boolean {
  const inputs = model.architecture?.input_modalities ?? [];
  const outputs = model.architecture?.output_modalities ?? [];
  const textOutput = outputs.length === 0 || outputs.includes('text');

  switch (purpose) {
    case 'default_transcription_model':
      return outputs.includes('transcription');
    case 'default_vision_model':
      return textOutput && inputs.includes('image');
    case 'default_document_model':
      return textOutput && inputs.includes('file');
    case 'default_x_analysis_model':
      return textOutput && isGrokModel(model);
    case 'default_chat_model':
    case 'default_web_search_model':
    default:
      return textOutput;
  }
}

/**
 * Verifica o conjunto de modelos efetivos contra um catálogo já autorizado
 * para uma chave. A disponibilidade é avaliada antes da modalidade para que a
 * API consiga explicar ao administrador se o modelo sumiu ou é incompatível.
 */
export function getModelCompatibilityFailures(
  effectiveModels: Record<ModelPurpose, string>,
  models: readonly OpenRouterModelCapabilities[],
): ModelCompatibilityFailure[] {
  const failures: ModelCompatibilityFailure[] = [];
  for (const purpose of MODEL_PURPOSES) {
    const modelId = effectiveModels[purpose];
    const model = models.find((candidate) => candidate.id === modelId);
    if (!model) {
      failures.push({ purpose, modelId, reason: 'unavailable' });
      continue;
    }
    if (!isModelCompatibleWithPurpose(purpose, model)) {
      failures.push({ purpose, modelId, reason: 'incompatible' });
    }
  }
  return failures;
}

function isGrokModel(model: OpenRouterModelCapabilities): boolean {
  const id = model.id.toLowerCase();
  const name = (model.name ?? '').toLowerCase();
  return id.startsWith('x-ai/grok') || name.includes('grok');
}
