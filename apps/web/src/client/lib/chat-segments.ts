// ============================================================================
// Segments cronológicos do turno do assistente (spec 078)
// ----------------------------------------------------------------------------
// O harness progressivo (#351) intercala raciocínio e chamadas de ferramenta
// ao longo de vários steps. Em vez de guardar `reasoning`/`tools` como campos
// fixos (sempre renderizados nessa ordem, perdendo a intercalação real), o
// turno vira uma lista `MessageSegment[]` na ORDEM real de chegada dos
// eventos SSE — cada novo pedaço de raciocínio ou ferramenta vira uma
// extensão do último segmento (se for do mesmo tipo) ou um novo segmento
// empilhado (se o tipo mudou). Puro e testável (sem DOM/React).
// ============================================================================

import { toolBlockState, type ToolState } from './chat-tools';

/** Evento de ferramenta — mesma forma do `StoredToolEvent` do backend. */
export type ToolEvent = {
  id: string;
  name: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
};

/** Segmento de raciocínio: texto acumulado + janela de tempo (só ao vivo). */
export type ReasoningSegment = {
  type: 'reasoning';
  id: string;
  text: string;
  startedAt: number;
  endedAt?: number;
};

/** Segmento de um grupo de ferramentas consecutivas (mesma posição cronológica). */
export type ToolGroupSegment = {
  type: 'tool-group';
  id: string;
  tools: ToolEvent[];
};

export type MessageSegment = ReasoningSegment | ToolGroupSegment;

/** Eventos de stream que afetam a linha do tempo de segments. */
export type SegmentEvent = { type: 'reasoning'; delta: string } | { type: 'tool'; tool: ToolEvent };

/**
 * Fecha (carimba `endedAt`) o segmento de raciocínio à direita, se houver um
 * ainda aberto. Idempotente — chamar sem raciocínio pendente não muda nada.
 * Usado quando chega o primeiro delta de texto final ou quando o turno
 * termina: a partir daí esse segmento nunca mais recebe deltas.
 */
export function closeTrailingReasoning(
  segments: readonly MessageSegment[],
  now: number = Date.now(),
): MessageSegment[] {
  const last = segments[segments.length - 1];
  if (!last || last.type !== 'reasoning' || last.endedAt != null) return [...segments];
  return [...segments.slice(0, -1), { ...last, endedAt: now }];
}

/**
 * Aplica UM evento de stream (delta de raciocínio ou update de ferramenta) ao
 * array de segments, preservando a ordem cronológica real:
 *
 * - `reasoning`: estende o ÚLTIMO segmento se ele já é um raciocínio aberto
 *   (`endedAt` ainda undefined); senão empilha um novo segmento.
 * - `tool`: primeiro procura a ferramenta (por id) em TODOS os tool-groups já
 *   existentes — se achar, é um update (tool-result/erro/aprovação) pra uma
 *   ferramenta já emitida, e atualiza in-place dentro do grupo certo, mesmo
 *   que não seja o último. Se não achar, é uma ferramenta nova: fecha um
 *   raciocínio aberto (a ferramenta encerra a fala) e estende o ÚLTIMO
 *   segmento se ele já é um tool-group, senão empilha um novo tool-group.
 */
export function applySegmentEvent(
  segments: readonly MessageSegment[],
  event: SegmentEvent,
  now: number = Date.now(),
): MessageSegment[] {
  if (event.type === 'reasoning') {
    const last = segments[segments.length - 1];
    if (last && last.type === 'reasoning' && last.endedAt == null) {
      return [...segments.slice(0, -1), { ...last, text: last.text + event.delta }];
    }
    const created: ReasoningSegment = {
      type: 'reasoning',
      id: `reasoning-${segments.length}`,
      text: event.delta,
      startedAt: now,
    };
    return [...segments, created];
  }

  const tool = event.tool;

  // Update de uma ferramenta já emitida: procura em TODOS os grupos, não só
  // no último — o tool-result de uma ferramenta pode chegar depois de outro
  // segmento de raciocínio/ferramenta já ter sido empilhado por cima.
  const groupIndex = segments.findIndex(
    (segment) => segment.type === 'tool-group' && segment.tools.some((item) => item.id === tool.id),
  );
  if (groupIndex >= 0) {
    return segments.map((segment, index) => {
      if (index !== groupIndex || segment.type !== 'tool-group') return segment;
      return {
        ...segment,
        tools: segment.tools.map((item) => (item.id === tool.id ? tool : item)),
      };
    });
  }

  // Ferramenta nova: fecha o raciocínio aberto (se houver) e empilha/estende.
  const closed = closeTrailingReasoning(segments, now);
  const last = closed[closed.length - 1];
  if (last && last.type === 'tool-group') {
    const extended: ToolGroupSegment = { ...last, tools: [...last.tools, tool] };
    return [...closed.slice(0, -1), extended];
  }
  const created: ToolGroupSegment = {
    type: 'tool-group',
    id: `tool-group-${closed.length}`,
    tools: [tool],
  };
  return [...closed, created];
}

/**
 * Constrói os segments de uma mensagem histórica/recarregada (só `tools`
 * persistido — raciocínio nunca é salvo, intencionalmente). Um único
 * tool-group com todas as ferramentas na ordem persistida, sem segmento de
 * raciocínio.
 */
export function segmentsFromPersistedTools(
  tools: readonly ToolEvent[] | null | undefined,
): MessageSegment[] {
  if (!tools || tools.length === 0) return [];
  return [{ type: 'tool-group', id: 'tool-group-history', tools: [...tools] }];
}

/**
 * `true` se algo ainda está em andamento: um raciocínio sem `endedAt`, ou
 * qualquer tool-group com ferramenta `running`/`approval-required`. Alimenta
 * o header do bloco de pensamento unificado ("Pensando" vs "Pensou por Xs").
 */
export function segmentsRunning(segments: readonly MessageSegment[]): boolean {
  return segments.some((segment) =>
    segment.type === 'reasoning'
      ? segment.endedAt == null
      : toolBlockState(segment.tools) === 'running',
  );
}
