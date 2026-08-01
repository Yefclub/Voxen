import { describe, expect, it } from 'bun:test';
import {
  applySegmentEvent,
  closeTrailingReasoning,
  parseMessageSegments,
  resolveThinkingTiming,
  segmentsFromPersistedTools,
  segmentsReasoningDuration,
  segmentsRunning,
  segmentsToolCount,
  thinkingInFlight,
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

  it('descarta entradas malformadas (sem name/id, ou state desconhecido) em vez de quebrar', () => {
    const good = tool('t1', 'completed');
    const malformed = [
      { approvalId: 'x', state: 'approved', noteId: 'n1' },
      { id: 't2', state: 'completed' },
      { id: 't3', name: '', state: 'completed' },
      { id: 't4', name: 'ok', state: 'bogus' },
      null,
      'garbage',
    ] as unknown as ToolEvent[];
    const segments = segmentsFromPersistedTools([good, ...malformed]);
    expect(segments).toEqual([{ type: 'tool-group', id: 'tool-group-history', tools: [good] }]);
  });

  it('só entradas malformadas retorna array vazio', () => {
    const malformed = [
      { approvalId: 'x', state: 'approved', noteId: 'n1' },
    ] as unknown as ToolEvent[];
    expect(segmentsFromPersistedTools(malformed)).toEqual([]);
  });
});

describe('segmentsRunning', () => {
  it('true se há raciocínio aberto', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000 },
    ];
    expect(segmentsRunning(segments)).toBe(true);
  });

  it('true se algum tool-group tem ferramenta running', () => {
    expect(
      segmentsRunning([{ type: 'tool-group', id: 'g0', tools: [tool('t1', 'running')] }]),
    ).toBe(true);
  });

  it('false se só há approval-required (HITL não mantém Pensando)', () => {
    expect(
      segmentsRunning([{ type: 'tool-group', id: 'g0', tools: [tool('t1', 'approval-required')] }]),
    ).toBe(false);
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

describe('segmentsReasoningDuration', () => {
  it('um único segmento de raciocínio: endedAt - startedAt', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000, endedAt: 1800 },
    ];
    expect(segmentsReasoningDuration(segments)).toBe(800);
  });

  it('vários segmentos de raciocínio: do startedAt do primeiro ao endedAt do último', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'a', startedAt: 1000, endedAt: 1200 },
      { type: 'tool-group', id: 'g0', tools: [{ id: 't1', name: 'search', state: 'completed' }] },
      { type: 'reasoning', id: 'r1', text: 'b', startedAt: 1500, endedAt: 2100 },
    ];
    expect(segmentsReasoningDuration(segments)).toBe(2100 - 1000);
  });

  it('inclui o processamento anterior ao primeiro delta quando o início do turno é conhecido', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'a', startedAt: 1000, endedAt: 1800 },
    ];
    expect(segmentsReasoningDuration(segments, 250)).toBe(1800 - 250);
  });

  it('sem segmento de raciocínio (turno só de ferramentas) retorna null', () => {
    const segments: MessageSegment[] = [
      { type: 'tool-group', id: 'g0', tools: [{ id: 't1', name: 'search', state: 'completed' }] },
    ];
    expect(segmentsReasoningDuration(segments)).toBeNull();
  });

  it('raciocínio ainda aberto (sem endedAt) retorna null', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1000 },
    ];
    expect(segmentsReasoningDuration(segments)).toBeNull();
  });

  it('timestamps invertidos ou não finitos retornam null', () => {
    expect(
      segmentsReasoningDuration([
        { type: 'reasoning', id: 'r0', text: 'x', startedAt: 3_000, endedAt: 2_000 },
      ]),
    ).toBeNull();
    expect(
      segmentsReasoningDuration([
        {
          type: 'reasoning',
          id: 'r0',
          text: 'x',
          startedAt: Number.NaN,
          endedAt: 2_000,
        },
      ]),
    ).toBeNull();
    expect(
      segmentsReasoningDuration([
        {
          type: 'reasoning',
          id: 'r0',
          text: 'x',
          startedAt: 1_000,
          endedAt: Number.POSITIVE_INFINITY,
        },
      ]),
    ).toBeNull();
  });

  it('array vazio retorna null', () => {
    expect(segmentsReasoningDuration([])).toBeNull();
  });

  it('sobrevive ao swap pro snapshot: a duração continua correta a partir só dos segments, sem cronômetro local', () => {
    // Simula um turno ao vivo completo (reasoning → tool → reasoning → texto
    // final), exatamente como o handler SSE de send() constrói via
    // applySegmentEvent, terminando com o fechamento explícito de fim de
    // turno (closeTrailingReasoning) que send() aplica antes de reanexar os
    // segments na mensagem vinda do snapshot do servidor. Depois do swap, o
    // ThinkingBlock remonta com `live=false` e startedAtRef/frozen zerados —
    // a duração tem que continuar vindo só destes segments.
    let segments: MessageSegment[] = [];
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'vou buscar' }, 1_000);
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'running') }, 1_200);
    segments = applySegmentEvent(segments, { type: 'tool', tool: tool('t1', 'completed') }, 1_400);
    segments = applySegmentEvent(segments, { type: 'reasoning', delta: 'agora respondo' }, 1_600);
    // fim do turno: texto final chega, fechando o raciocínio em aberto — é o
    // que closeTrailingReasoning faz tanto no evento 'text' quanto no fim do
    // loop de leitura do stream em send().
    segments = closeTrailingReasoning(segments, 2_500);

    // estado local do componente NÃO existe mais após o remount (live=false,
    // frozen=null) — só os segments reanexados na mensagem restam.
    expect(segmentsReasoningDuration(segments, 500)).toBe(2_500 - 500);
  });
});

describe('resolveThinkingTiming', () => {
  it('não reativa cronômetro para reasoning histórico aberto', () => {
    const segments: MessageSegment[] = [
      { type: 'reasoning', id: 'r0', text: 'interrompido', startedAt: 1_000 },
    ];

    expect(resolveThinkingTiming(segments, false, 500, 99_000)).toEqual({
      inFlight: false,
      duration: null,
    });
  });

  it('usa elapsed somente enquanto o stream atual está vivo', () => {
    expect(resolveThinkingTiming([], true, 500, 1_250)).toEqual({
      inFlight: true,
      duration: 1_250,
    });
  });
});

// ============================================================================
// Compactação do bloco ao fim do turno (spec 126)
// ============================================================================

describe('thinkingInFlight', () => {
  const running: MessageSegment[] = [
    { type: 'tool-group', id: 'g0', tools: [tool('t1', 'running')] },
  ];
  const done: MessageSegment[] = [
    { type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed')] },
  ];

  it('turno encerrado nunca está em voo', () => {
    expect(thinkingInFlight(done, false, false)).toBe(false);
    expect(thinkingInFlight(running, false, true)).toBe(false);
  });

  it('turno ao vivo sem resposta final segue em voo mesmo entre ferramentas', () => {
    expect(thinkingInFlight(done, true, false)).toBe(true);
    expect(thinkingInFlight([], true, false)).toBe(true);
  });

  it('quando a resposta final começa, o bloco deixa de estar em voo', () => {
    expect(thinkingInFlight(done, true, true)).toBe(false);
  });

  it('resposta final seguida de nova ferramenta reabre o bloco', () => {
    expect(thinkingInFlight(running, true, true)).toBe(true);
  });
});

describe('segmentsToolCount', () => {
  it('conta ferramentas de todos os grupos', () => {
    const segments: MessageSegment[] = [
      { type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed'), tool('t2', 'completed')] },
      { type: 'reasoning', id: 'r0', text: 'x', startedAt: 1, endedAt: 2 },
      { type: 'tool-group', id: 'g1', tools: [tool('t3', 'error')] },
    ];
    expect(segmentsToolCount(segments)).toBe(3);
  });

  it('zero quando o turno só teve raciocínio', () => {
    expect(segmentsToolCount([{ type: 'reasoning', id: 'r0', text: 'x', startedAt: 1 }])).toBe(0);
    expect(segmentsToolCount([])).toBe(0);
  });
});

// ============================================================================
// Normalização do JSONB (spec 126)
// ----------------------------------------------------------------------------
// `segments` chega do snapshot só *tipado*; a coluna é JSONB sem schema. Desde
// que o render passou a chamar `segment.text.trim()`, um registro sem `text`
// lança TypeError e o ErrorBoundary global derruba a página inteira.
// ============================================================================

describe('parseMessageSegments', () => {
  it('null quando o valor não é uma lista — chamador cai no fallback de tools', () => {
    expect(parseMessageSegments(null)).toBeNull();
    expect(parseMessageSegments(undefined)).toBeNull();
    expect(parseMessageSegments('[]')).toBeNull();
    expect(parseMessageSegments({ type: 'reasoning' })).toBeNull();
  });

  it('raciocínio sem `text` vira string vazia em vez de derrubar o render', () => {
    const parsed = parseMessageSegments([{ type: 'reasoning', id: 'r0', startedAt: 10 }]);

    expect(parsed).toEqual([{ type: 'reasoning', id: 'r0', text: '', startedAt: 10 }]);
    // O contrato que interessa: o render chama .trim() sem explodir.
    expect(() => parsed?.map((s) => (s.type === 'reasoning' ? s.text.trim() : ''))).not.toThrow();
  });

  it('preserva raciocínio íntegro, com e sem `endedAt`', () => {
    expect(
      parseMessageSegments([
        { type: 'reasoning', id: 'r0', text: 'oi', startedAt: 10, endedAt: 20 },
        { type: 'reasoning', id: 'r1', text: 'em curso', startedAt: 30 },
      ]),
    ).toEqual([
      { type: 'reasoning', id: 'r0', text: 'oi', startedAt: 10, endedAt: 20 },
      { type: 'reasoning', id: 'r1', text: 'em curso', startedAt: 30 },
    ]);
  });

  it('descarta segmentos sem id, de tipo desconhecido ou não-objetos', () => {
    expect(
      parseMessageSegments([
        { type: 'reasoning', text: 'sem id', startedAt: 1 },
        { type: 'coisa-nova', id: 'x', text: 'y', startedAt: 1 },
        null,
        'texto',
      ]),
    ).toEqual([]);
  });

  it('descarta raciocínio com `startedAt` inválido (evita duração absurda)', () => {
    expect(
      parseMessageSegments([
        { type: 'reasoning', id: 'r0', text: 'x', startedAt: 'ontem' },
        { type: 'reasoning', id: 'r1', text: 'x', startedAt: Number.NaN },
        { type: 'reasoning', id: 'r2', text: 'x', startedAt: -5 },
        { type: 'reasoning', id: 'r3', text: 'x' },
      ]),
    ).toEqual([]);
  });

  it('filtra ferramentas malformadas dentro do tool-group', () => {
    expect(
      parseMessageSegments([
        {
          type: 'tool-group',
          id: 'g0',
          tools: [tool('t1', 'completed'), { id: 't2', state: 'completed' }, { id: 't3' }],
        },
      ]),
    ).toEqual([{ type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed')] }]);
  });

  it('descarta tool-group sem ferramenta válida ou com `tools` não-lista', () => {
    expect(
      parseMessageSegments([
        { type: 'tool-group', id: 'g0', tools: [{ id: 'sem-nome', state: 'completed' }] },
        { type: 'tool-group', id: 'g1', tools: 'nada' },
      ]),
    ).toEqual([]);
  });

  it('normaliza uma timeline mista preservando a ordem', () => {
    expect(
      parseMessageSegments([
        { type: 'reasoning', id: 'r0', text: 'pensando', startedAt: 1, endedAt: 2 },
        { type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed')] },
        { type: 'reasoning', id: 'r1', startedAt: 3 },
      ]),
    ).toEqual([
      { type: 'reasoning', id: 'r0', text: 'pensando', startedAt: 1, endedAt: 2 },
      { type: 'tool-group', id: 'g0', tools: [tool('t1', 'completed')] },
      { type: 'reasoning', id: 'r1', text: '', startedAt: 3 },
    ]);
  });
});
