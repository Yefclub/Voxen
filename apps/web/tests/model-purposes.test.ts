// ============================================================================
// Unit tests — compatibilidade de modelo por finalidade (spec 123)
// ============================================================================

import { describe, expect, it } from 'bun:test';
import {
  canonicalModelForPurpose,
  fallbackSettingForPurpose,
  getModelCompatibilityFailures,
  isModelCompatibleWithPurpose,
  isModelPurpose,
  MODEL_PURPOSES,
  suggestFallbackForPurpose,
} from '../src/lib/model-defaults';

const textModel = {
  id: 'x-ai/grok-4.5',
  name: 'Grok 4.5',
  architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
};

const transcriptionModel = {
  id: 'x-ai/grok-stt-1.0',
  name: 'Grok STT',
  architecture: { output_modalities: ['transcription'] },
};

const textOnlyModel = {
  id: 'openai/gpt-5-mini',
  name: 'GPT-5 mini',
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
};

const visionModel = {
  id: 'openai/gpt-5-vision',
  name: 'GPT-5 Vision',
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
};

const documentModel = {
  id: 'openai/gpt-5-file',
  name: 'GPT-5 Documentos',
  architecture: { input_modalities: ['text', 'file'], output_modalities: ['text'] },
};

const grokById = {
  id: 'x-ai/grok-4-fast',
  architecture: { output_modalities: ['text'] },
};

const grokByName = {
  id: 'some-provider/model-x',
  name: 'Grok-compatible relay',
  architecture: { output_modalities: ['text'] },
};

describe('MODEL_PURPOSES', () => {
  it('lista exatamente as 6 finalidades existentes', () => {
    expect(MODEL_PURPOSES).toEqual([
      'default_chat_model',
      'default_transcription_model',
      'default_web_search_model',
      'default_vision_model',
      'default_document_model',
      'default_x_analysis_model',
    ]);
  });

  it('maps every primary purpose to an independent fallback setting', () => {
    expect(MODEL_PURPOSES.map(fallbackSettingForPurpose)).toEqual([
      'fallback_chat_model',
      'fallback_transcription_model',
      'fallback_web_search_model',
      'fallback_vision_model',
      'fallback_document_model',
      'fallback_x_analysis_model',
    ]);
  });

  it('isModelPurpose valida strings arbitrárias', () => {
    expect(isModelPurpose('default_chat_model')).toBe(true);
    expect(isModelPurpose('default_unknown_model')).toBe(false);
    expect(isModelPurpose('')).toBe(false);
  });

  it('canonicalModelForPurpose retorna o modelo canônico de cada finalidade', () => {
    expect(canonicalModelForPurpose('default_chat_model')).toBe('deepseek/deepseek-v4-flash-0731');
    expect(canonicalModelForPurpose('default_transcription_model')).toBe('x-ai/grok-stt-1.0');
    expect(canonicalModelForPurpose('default_web_search_model')).toBe(
      'deepseek/deepseek-v4-flash-0731',
    );
    expect(canonicalModelForPurpose('default_vision_model')).toBe('openai/gpt-5.6-luna');
    expect(canonicalModelForPurpose('default_document_model')).toBe('openai/gpt-5.6-luna');
    expect(canonicalModelForPurpose('default_x_analysis_model')).toBe('x-ai/grok-4.5');
  });
});

describe('suggestFallbackForPurpose', () => {
  it('returns a compatible alternative and never repeats the primary', () => {
    expect(
      suggestFallbackForPurpose('default_vision_model', visionModel.id, [
        visionModel,
        textOnlyModel,
        textModel,
      ]),
    ).toBe(textModel.id);
  });

  it('prefers a paid candidate before a shared free-tier candidate', () => {
    const free = { ...textOnlyModel, id: 'openai/gpt-5-mini:free' };
    expect(
      suggestFallbackForPurpose('default_chat_model', textModel.id, [
        textModel,
        free,
        textOnlyModel,
      ]),
    ).toBe(textOnlyModel.id);
  });

  it('returns null when the catalog has no compatible alternative', () => {
    expect(
      suggestFallbackForPurpose('default_transcription_model', transcriptionModel.id, [
        transcriptionModel,
        textOnlyModel,
      ]),
    ).toBeNull();
  });
});

describe('isModelCompatibleWithPurpose', () => {
  it('chat aceita qualquer modelo de saída texto', () => {
    expect(isModelCompatibleWithPurpose('default_chat_model', textModel)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_chat_model', textOnlyModel)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_chat_model', transcriptionModel)).toBe(false);
  });

  it('busca web segue a mesma regra do chat (texto)', () => {
    expect(isModelCompatibleWithPurpose('default_web_search_model', textOnlyModel)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_web_search_model', transcriptionModel)).toBe(
      false,
    );
  });

  it('transcrição exige output_modalities incluir transcription', () => {
    expect(isModelCompatibleWithPurpose('default_transcription_model', transcriptionModel)).toBe(
      true,
    );
    expect(isModelCompatibleWithPurpose('default_transcription_model', textModel)).toBe(false);
  });

  it('visão exige input_modalities incluir image', () => {
    expect(isModelCompatibleWithPurpose('default_vision_model', visionModel)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_vision_model', textOnlyModel)).toBe(false);
  });

  it('documento exige input_modalities incluir file', () => {
    expect(isModelCompatibleWithPurpose('default_document_model', documentModel)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_document_model', textOnlyModel)).toBe(false);
  });

  it('análise X exige ser um modelo Grok/xAI (por id ou nome)', () => {
    expect(isModelCompatibleWithPurpose('default_x_analysis_model', grokById)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_x_analysis_model', grokByName)).toBe(true);
    expect(isModelCompatibleWithPurpose('default_x_analysis_model', textOnlyModel)).toBe(false);
  });
});

describe('getModelCompatibilityFailures', () => {
  it('identifica modelo ausente e modelo presente com modalidade incompatível', () => {
    const failures = getModelCompatibilityFailures(
      {
        default_chat_model: textModel.id,
        default_transcription_model: transcriptionModel.id,
        default_web_search_model: textModel.id,
        default_vision_model: textOnlyModel.id,
        default_document_model: 'missing/document',
        default_x_analysis_model: grokById.id,
      },
      [textModel, transcriptionModel, textOnlyModel, grokById],
    );

    expect(failures).toEqual([
      {
        purpose: 'default_vision_model',
        modelId: textOnlyModel.id,
        reason: 'incompatible',
      },
      {
        purpose: 'default_document_model',
        modelId: 'missing/document',
        reason: 'unavailable',
      },
    ]);
  });
});
