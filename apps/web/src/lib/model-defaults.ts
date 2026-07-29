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
