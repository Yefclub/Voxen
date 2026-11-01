// ============================================================================
// Capacidades públicas da instância — projeção mínima para a interface.
// ============================================================================

import { isModelCompatibleWithPurpose, type ModelPurpose } from './model-defaults';
import { listUserModels, type OpenRouterProbePurpose, type OrModel } from './openrouter';
import { getSettings } from './settings';

type CapabilityDefinition = {
  id: OpenRouterProbePurpose;
  setting:
    | 'default_chat_model'
    | 'default_transcription_model'
    | 'default_web_search_model'
    | 'default_vision_model'
    | 'default_document_model'
    | 'default_x_analysis_model';
  purpose: ModelPurpose | null;
};

const CAPABILITIES: readonly CapabilityDefinition[] = [
  { id: 'chat', setting: 'default_chat_model', purpose: 'default_chat_model' },
  {
    id: 'transcription',
    setting: 'default_transcription_model',
    purpose: 'default_transcription_model',
  },
  { id: 'webSearch', setting: 'default_web_search_model', purpose: 'default_web_search_model' },
  { id: 'vision', setting: 'default_vision_model', purpose: 'default_vision_model' },
  { id: 'document', setting: 'default_document_model', purpose: 'default_document_model' },
  { id: 'xAnalysis', setting: 'default_x_analysis_model', purpose: 'default_x_analysis_model' },
];

const INPUT_KEYS = [
  'openrouter_api_key',
  'default_chat_model',
  'default_transcription_model',
  'default_web_search_model',
  'default_vision_model',
  'default_document_model',
  'default_x_analysis_model',
] as const;

const PUBLIC_CAPABILITIES_TTL_MS = 60_000;
let cache: { expiresAt: number; value: { active: OpenRouterProbePurpose[] } } | null = null;
let inFlight: Promise<{ active: OpenRouterProbePurpose[] }> | null = null;

function isActive(
  capability: CapabilityDefinition,
  modelId: string | null,
  models: readonly OrModel[],
): boolean {
  if (!modelId) return false;
  const model = models.find((candidate) => candidate.id === modelId);
  return Boolean(
    model && (!capability.purpose || isModelCompatibleWithPurpose(capability.purpose, model)),
  );
}

/** Projeção sem modelos, custos ou diagnósticos administrativos. */
export async function getPublicActiveCapabilities(): Promise<{ active: OpenRouterProbePurpose[] }> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const settings = await getSettings(INPUT_KEYS);
    if (!settings.openrouter_api_key) return { active: [] };
    let models: OrModel[];
    try {
      models = await listUserModels(settings.openrouter_api_key);
    } catch {
      return { active: [] };
    }
    const active = CAPABILITIES.flatMap((capability) => {
      const modelId = settings[capability.setting];
      return isActive(capability, modelId, models) ? [capability.id] : [];
    });
    return { active };
  })()
    .then((value) => {
      cache = { value, expiresAt: Date.now() + PUBLIC_CAPABILITIES_TTL_MS };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
