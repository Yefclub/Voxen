import { describe, expect, test } from 'bun:test';
import { isFinalTextDelta } from './stream-segments';

describe('início da resposta final no stream do turno', () => {
  test('delta de texto vazio não conta como resposta começando', () => {
    // Regressão do bump de `ai` 7.0.22 → 7.0.62. A 7.0.42 passou a entregar
    // `text-delta` de texto vazio quando o chunk carrega `providerMetadata`;
    // antes o SDK filtrava. Provado com o provedor mock do próprio SDK: em
    // 7.0.22 o chunk não chega ao `fullStream`, em 7.0.62 chega.
    expect(isFinalTextDelta({ type: 'text-delta', text: '' })).toBe(false);
  });

  test('delta com texto conta', () => {
    expect(isFinalTextDelta({ type: 'text-delta', text: 'r' })).toBe(true);
    expect(isFinalTextDelta({ type: 'text-delta', text: 'resposta' })).toBe(true);
  });

  test('só text-delta conta, e só com texto de verdade', () => {
    expect(isFinalTextDelta({ type: 'reasoning-delta', text: 'pensando' })).toBe(false);
    expect(isFinalTextDelta({ type: 'tool-call', text: 'x' })).toBe(false);
    expect(isFinalTextDelta({ type: 'text-delta' })).toBe(false);
    expect(isFinalTextDelta({ type: 'text-delta', text: null })).toBe(false);
    expect(isFinalTextDelta({ type: 'text-delta', text: 0 })).toBe(false);
    expect(isFinalTextDelta({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A consequência que o predicado protege, com a mesma máquina de segmentos do
// `runtime.ts`. Asserção sobre a LISTA inteira: é ela que distingue "um
// raciocínio contínuo" de "dois blocos", e nenhuma asserção sobre um instante
// isolado faria isso.
// ---------------------------------------------------------------------------

type Segment = { type: 'reasoning'; id: string; text: string; endedAt?: number };

function closeReasoning(segments: Segment[], now = 1): void {
  const last = segments.at(-1);
  if (last?.type === 'reasoning' && last.endedAt === undefined) last.endedAt = now;
}

function appendReasoning(segments: Segment[], delta: string): void {
  const last = segments.at(-1);
  if (last?.type === 'reasoning' && last.endedAt === undefined) {
    last.text += delta;
    return;
  }
  segments.push({ type: 'reasoning', id: `reasoning-${segments.length}`, text: delta });
}

/** Roda a sequência do turno usando o predicado real como guarda. */
function runTurn(parts: { type: string; text?: unknown }[]): Segment[] {
  const segments: Segment[] = [];
  for (const part of parts) {
    if (part.type === 'reasoning-delta') appendReasoning(segments, String(part.text));
    else if (isFinalTextDelta(part)) closeReasoning(segments);
  }
  return segments;
}

describe('segmentação de raciocínio ao redor da resposta', () => {
  test('delta vazio no meio não parte o raciocínio em dois', () => {
    const segments = runTurn([
      { type: 'reasoning-delta', text: 'pensando' },
      { type: 'text-delta', text: '' }, // o chunk que a 7.0.42 passou a entregar
      { type: 'reasoning-delta', text: ' mais' },
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('pensando mais');
    expect(segments[0]!.endedAt).toBeUndefined();
  });

  test('a resposta de verdade fecha o raciocínio', () => {
    const segments = runTurn([
      { type: 'reasoning-delta', text: 'pensando' },
      { type: 'text-delta', text: 'resposta' },
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.endedAt).toBeDefined();
  });

  test('raciocínio depois da resposta abre bloco novo, como deve', () => {
    const segments = runTurn([
      { type: 'reasoning-delta', text: 'primeiro' },
      { type: 'text-delta', text: 'resposta' },
      { type: 'reasoning-delta', text: 'segundo' },
    ]);

    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.text)).toEqual(['primeiro', 'segundo']);
  });
});
