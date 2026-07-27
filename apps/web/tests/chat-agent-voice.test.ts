import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runtimeSource = readFileSync(join(import.meta.dir, '../src/lib/chat/runtime.ts'), 'utf8');

describe('AGENT_INSTRUCTIONS user-facing voice', () => {
  test('forbids tool names and API syntax in the final answer', () => {
    expect(runtimeSource).toContain('Comunicação com o usuário (OBRIGATÓRIO');
    expect(runtimeSource).toContain('NUNCA mencione nomes de ferramentas');
    expect(runtimeSource).toContain('outline_transcript(...)');
    expect(runtimeSource).toContain('propose_create_note(...)');
    expect(runtimeSource).toContain('NÃO diga ao usuário para “pedir” ou “chamar” uma ferramenta');
  });

  test('requires natural product language for next steps', () => {
    expect(runtimeSource).toContain('português natural de produto');
    expect(runtimeSource).toContain('posso montar uma nota com o resumo');
    expect(runtimeSource).toContain('não por IDs crus');
  });
});
