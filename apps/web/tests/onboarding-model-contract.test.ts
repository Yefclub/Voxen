import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(import.meta.dir, '..', path), 'utf8');

describe('contrato unificado de configuração OpenRouter', () => {
  test('onboarding solicita a chave sem introduzir uma etapa de escolha de modelos', () => {
    const onboarding = read('src/client/pages/onboarding.tsx');
    expect(onboarding).toContain(
      "type Step = 'idioma' | 'fuso' | 'key' | 'modo' | 'perfil' | 'pronto'",
    );
    expect(onboarding).toContain("apiPost('/api/setup'");
    expect(onboarding).toContain('openrouter_api_key: apiKey.trim()');
    expect(onboarding).not.toContain('ModelPicker');
    expect(onboarding).not.toContain("setStep('modelos')");
  });

  test('configuração administrativa solicita somente a chave e não lista modelos', () => {
    const setup = read('src/client/pages/setup.tsx');
    expect(setup).not.toContain('ModelPicker');
    expect(setup).not.toContain('/api/setup/models');
    expect(setup).not.toContain('default_chat_model');
    expect(setup).not.toContain('default_transcription_model');
    expect(setup).toContain('body.openrouter_api_key = apiKey.trim()');
  });
});
