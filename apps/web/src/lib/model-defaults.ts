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
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
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
