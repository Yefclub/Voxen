import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(import.meta.dir, '..', path), 'utf8');

describe('contrato entre onboarding e configuração avançada', () => {
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

  test('configuração mantém os seletores avançados depois do onboarding', () => {
    const setup = read('src/client/pages/setup.tsx');
    expect(setup).toContain("import { ModelPicker } from '../components/model-picker'");
    expect(setup.match(/<ModelPicker/g)?.length).toBeGreaterThanOrEqual(6);
    expect(setup).toContain("type Step = 'loading' | 'key' | 'modelos' | 'done'");
  });
});
