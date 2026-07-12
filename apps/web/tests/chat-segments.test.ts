import { describe, expect, it } from 'bun:test';
import {
  applySegmentEvent,
  closeTrailingReasoning,
  segmentsFromPersistedTools,
  segmentsRunning,
  type MessageSegment,
  type ToolEvent,
} from '../src/client/lib/chat-segments';

function tool(id: string, state: ToolEvent['state'], name = 'search_transcripts'): ToolEvent {
  return { id, name, state };
}

describe('applySegmentEvent — reasoning', () => {
  it('raciocínio solo: um único segmento que cresce a cada delta', () => {
    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'Preciso ' }, 1000);
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'buscar' }, 1100);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: 'reasoning',
      text: 'Preciso buscar',
      startedAt: 1000,
    });
    expect((segments[0] as { endedAt?: number }).endedAt).toBeUndefined();
  });

  it('reabre um novo segmento se o anterior já foi fechado', () => {
    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'a' }, 1000);
    segments = closeTrailingReasoning(segments, 1500);
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'b' }, 2000);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ text: 'a', startedAt: 1000, endedAt: 1500 });
    expect(segments[1]).toMatchObject({ text: 'b', startedAt: 2000 });
  });
});

describe('applySegmentEvent — reasoning → tool → reasoning', () => {
  it('gera 3 segments (não funde raciocínio dos dois lados da ferramenta)', () => {
    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'vou buscar' }, 1000);
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'running') }, 1200);
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'achei, vou ler' }, 1500);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: 'reasoning', text: 'vou buscar', endedAt: 1200 });
    expect(segments[1]).toMatchObject({ type: 'tool-group' });
    expect((segments[1] as { tools: ToolEvent[] }).tools.map((t) => t.id)).toEqual(['t1']);
    expect(segments[2]).toMatchObject({
      type: 'reasoning',
      text: 'achei, vou ler',
      startedAt: 1500,
    });
    expect((segments[2] as { endedAt?: number }).endedAt).toBeUndefined();
  });
});

describe('applySegmentEvent — tools', () => {
  it('múltiplas tools consecutivas caem no MESMO grupo', () => {
    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'running') }, 1000);
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t2', 'running') }, 1100);
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t3', 'running') }, 1200);

    expect(segments).toHaveLength(1);
    const group = segments[0] as { type: 'tool-group'; tools: ToolEvent[] };
    expect(group.type).toBe('tool-group');
    expect(group.tools.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('update por id (tool-result) atualiza a ferramenta in-place no grupo, sem duplicar', () => {
    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'running') }, 1000);
    segments = applySegmentEvent(
      segments,
      { type: 'tool', tool: { ...tool('t1', 'completed'), output: { ok: true } } },
      1300,
    );

    expect(segments).toHaveLength(1);
    const group = segments[0] as { type: 'tool-group'; tools: ToolEvent[] };
    expect(group.tools).toHaveLength(1);
    expect(group.tools[0]).toMatchObject({ id: 't1', state: 'completed', output: { ok: true } });
  });

  it('update por id encontra a ferramenta num grupo NÃO-último (procura em todos os grupos)', () => {
    let segments: MessageSegment[] = [];
    // grupo 0: t1 (running)
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'running') }, 1000);
    // raciocínio fecha o grupo 0 e abre um segmento de reasoning
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'agora outra coisa' }, 1100);
    // grupo 1 (último): t2 (running)
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t2', 'running') }, 1300);

    expect(segments).toHaveLength(3);

    // update de t1 (do grupo NÃO-último, índice 0) deve achar e atualizar ali,
    // sem tocar no grupo 1 (último) nem criar um 4º segmento.
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'completed') }, 1400);

    expect(segments).toHaveLength(3);
    const group0 = segments[0] as { type: 'tool-group'; tools: ToolEvent[] };
    const group2 = segments[2] as { type: 'tool-group'; tools: ToolEvent[] };
    expect(group0.tools).toEqual([{ id: 't1', name: 'search_transcripts', state: 'completed' }]);
    expect(group2.tools.map((t) => ({ id: t.id, state: t.state }))).toEqual([
      { id: 't2', state: 'running' },
    ]);
  });
});

describe('closeTrailingReasoning', () => {
  it('fecha o raciocínio aberto no fim do array', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000 },
    ];
    const closed = closeTrailingReasoning(segments, 2000);
    expect(closed[0]).toMatchObject({ endedAt: 2000 });
  });

  it('é idempotente — não muda nada se já está fechado ou não é reasoning', () => {
    const closedReasoning: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000, endedAt: 1500 },
    ];
    expect(closeTrailingReasoning(closedReasoning, 2000)).toEqual(closedReasoning);

    const toolGroup: MessageSegment[] = [
      { type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed')] },
    ];
    expect(closeTrailingReasoning(toolGroup, 2000)).toEqual(toolGroup);

    expect(closeTrailingReasoning([], 2000)).toEqual([]);
  });
});

describe('segmentsFromPersistedTools (mensagem histórica)', () => {
  it('só tools, sem reasoning: um único tool-group na ordem persistida', () => {
    const tools = [tool('t1', 'completed'), tool('t2', 'error')];
    const segments = segmentsFromPersistedTools(tools);
    expect(segments).toEqual([{ type: 'tool-group', id: 'tool-group-history', tools }]);
  });

  it('sem tools (null ou vazio) retorna array vazio', () => {
    expect(segmentsFromPersistedTools(null)).toEqual([]);
    expect(segmentsFromPersistedTools(undefined)).toEqual([]);
    expect(segmentsFromPersistedTools([])).toEqual([]);
  });
});

describe('segmentsRunning', () => {
  it('true se há raciocínio aberto', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000 },
    ];
    expect(segmentsRunning(segments)).toBe(true);
  });

  it('true se algum tool-group tem ferramenta running/approval-required', () => {
    expect(
      segmentsRunning([{ type: 'tool-group', id: 'g0', tools: [tool('t1', 'running')] }]),
    ).toBe(true);
    expect(
      segmentsRunning([{ type: 'tool-group', id: 'g0', tools: [tool('t1', 'approval-required')] }]),
    ).toBe(true);
  });

  it('false quando tudo terminou (reasoning fechado + tools completos/erro)', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000, endedAt: 1200 },
      { type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed'), tool('t2', 'error')] },
    ];
    expect(segmentsRunning(segments)).toBe(false);
  });

  it('array vazio não está rodando', () => {
    expect(segmentsRunning([])).toBe(false);
  });
});
