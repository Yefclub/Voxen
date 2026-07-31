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

const VALID_TOOL_STATES: readonly ToolState[] = [
  'running',
  'completed',
  'error',
  'approval-required',
];

/** Evento de ferramenta — mesma forma do `StoredToolEvent` do backend. */
export type ToolEvent = {
  id: string;
  name: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
};

/** Segmento de raciocínio: texto acumulado + janela de tempo persistível. */
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
 * `tools` vem de uma coluna JSONB sem validação de schema — dados
 * historicamente malformados (ou gravados por um bug futuro) não podem
 * chegar ao render, já que `name`/`state` inválidos derrubam o toolblock
 * inteiro (ex.: incidente com `HITL_RESPONSE` sem `name`, ver CHANGELOG).
 */
function isValidToolEvent(tool: unknown): tool is ToolEvent {
  if (!tool || typeof tool !== 'object') return false;
  const candidate = tool as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.state === 'string' &&
    VALID_TOOL_STATES.includes(candidate.state as ToolState)
  );
}

/**
 * Compatibilidade para mensagens históricas sem `segments` (só `tools`
 * persistido). Um único
 * tool-group com todas as ferramentas na ordem persistida, sem segmento de
 * raciocínio.
 */
export function segmentsFromPersistedTools(
  tools: readonly ToolEvent[] | null | undefined,
): MessageSegment[] {
  if (!tools || tools.length === 0) return [];
  const valid = tools.filter(isValidToolEvent);
  if (valid.length === 0) return [];
  return [{ type: 'tool-group', id: 'tool-group-history', tools: valid }];
}

/**
 * Normaliza os `segments` vindos do snapshot.
 *
 * `ChatMessage.segments` é uma coluna JSONB sem schema, e o backend faz
 * `as StoredMessageSegment[]` sem validar (`runtime.ts`) — o que chega ao
 * render é dado cru do Postgres, só *tipado* como `MessageSegment[]`. Até a
 * spec 119 isso era inofensivo (`{segment.text}` com `undefined` não
 * renderiza nada); desde a spec 126 o render chama `segment.text.trim()`, que
 * LANÇA `TypeError` — e o ErrorBoundary é global (`main.tsx`), então UMA
 * mensagem malformada apaga o app inteiro. Mesmo cuidado que `tools` já
 * recebe em `isValidToolEvent`, criado depois do incidente com
 * `HITL_RESPONSE` sem `name`.
 *
 * Retorna `null` quando o valor não é sequer uma lista: aí o chamador cai no
 * fallback histórico (`segmentsFromPersistedTools`), em vez de exibir um
 * turno vazio.
 */
export function parseMessageSegments(value: unknown): MessageSegment[] | null {
  if (!Array.isArray(value)) return null;
  const normalized: MessageSegment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    const id = typeof candidate.id === 'string' && candidate.id.length > 0 ? candidate.id : null;
    if (!id) continue;

    if (candidate.type === 'reasoning') {
      // `startedAt` inválido alimentaria `segmentsReasoningDuration` com uma
      // janela absurda ("Pensou por 57 anos"), então o segmento é descartado.
      if (typeof candidate.startedAt !== 'number' || !Number.isFinite(candidate.startedAt))
        continue;
      if (candidate.startedAt < 0) continue;
      const endedAt =
        typeof candidate.endedAt === 'number' && Number.isFinite(candidate.endedAt)
          ? candidate.endedAt
          : undefined;
      // Texto ausente não descarta o segmento: sem texto o render já cai no
      // resumo operacional ("Raciocinando…"), preservando a cronologia.
      const text = typeof candidate.text === 'string' ? candidate.text : '';
      const segment: ReasoningSegment = {
        type: 'reasoning',
        id,
        text,
        startedAt: candidate.startedAt,
      };
      normalized.push(endedAt == null ? segment : { ...segment, endedAt });
      continue;
    }

    if (candidate.type === 'tool-group') {
      if (!Array.isArray(candidate.tools)) continue;
      const tools = candidate.tools.filter(isValidToolEvent);
      if (tools.length === 0) continue;
      normalized.push({ type: 'tool-group', id, tools });
    }
  }
  return normalized;
}

/**
 * `true` se algo ainda está em andamento: um raciocínio sem `endedAt`, ou
 * qualquer tool-group com ferramenta `running`. Aprovação pendente (HITL) não
 * conta — o card fica acima do composer (spec 090).
 */
export function segmentsRunning(segments: readonly MessageSegment[]): boolean {
  return segments.some((segment) =>
    segment.type === 'reasoning'
      ? segment.endedAt == null
      : toolBlockState(segment.tools) === 'running',
  );
}

/**
 * Duração (ms) do turno derivada dos timestamps dos PRÓPRIOS segments de
 * raciocínio: do `startedAt` do primeiro ao `endedAt` do último. Serve de
 * fallback pro cronômetro local do `ThinkingBlock` (`startedAtRef`/`frozen`),
 * que é estado de componente e por isso NÃO sobrevive quando `send()` troca
 * as mensagens pelo snapshot do servidor ao fim do turno — o React remonta o
 * componente (a mensagem ganha o id real do banco, mudando a `key`), zerando
 * esse estado local. Esta função deriva a duração a partir dos timestamps
 * persistidos, sem depender de estado local.
 *
 * `null` se não há segmento de raciocínio (turno só de ferramentas — sem
 * duração, como já era antes desta spec) ou se algum ainda está aberto (sem
 * `endedAt` — não deveria ocorrer quando o turno já terminou).
 */
export function segmentsReasoningDuration(
  segments: readonly MessageSegment[],
  turnStartedAt?: number,
): number | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const segment of segments) {
    if (segment.type !== 'reasoning') continue;
    if (segment.endedAt == null) return null;
    if (
      !Number.isFinite(segment.startedAt) ||
      !Number.isFinite(segment.endedAt) ||
      segment.startedAt < 0 ||
      segment.endedAt < segment.startedAt
    ) {
      return null;
    }
    start = start == null ? segment.startedAt : Math.min(start, segment.startedAt);
    end = end == null ? segment.endedAt : Math.max(end, segment.endedAt);
  }
  if (start == null || end == null) return null;
  const effectiveStart =
    turnStartedAt != null && Number.isFinite(turnStartedAt)
      ? Math.min(turnStartedAt, start)
      : start;
  const duration = end - effectiveStart;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/**
 * Total de ferramentas chamadas no turno — insumo do resumo compacto exibido
 * no cabeçalho quando o bloco está recolhido (spec 126).
 */
export function segmentsToolCount(segments: readonly MessageSegment[]): number {
  let total = 0;
  for (const segment of segments) {
    if (segment.type === 'tool-group') total += segment.tools.length;
  }
  return total;
}

/**
 * O bloco "Pensando" está em voo?
 *
 * Antes bastava `live` (stream aberto), o que mantinha a timeline inteira
 * expandida enquanto a resposta final era digitada — empurrando o texto pra
 * fora da tela justamente na hora de ler (spec 126). Agora, assim que o
 * primeiro trecho da resposta final chega (`answering`), o bloco sai de voo e
 * se compacta; se o harness voltar a chamar ferramenta depois disso, ele
 * reabre. Gaps de milissegundos entre ferramentas continuam NÃO colapsando o
 * bloco, porque antes da resposta final o turno é sempre considerado em voo.
 */
export function thinkingInFlight(
  segments: readonly MessageSegment[],
  live: boolean,
  answering: boolean,
): boolean {
  if (!live) return false;
  if (!answering) return true;
  return segmentsRunning(segments);
}

export interface ThinkingTiming {
  inFlight: boolean;
  duration: number | null;
}

/**
 * Somente o stream atual pode iniciar o cronômetro de parede. Um snapshot
 * histórico com evento incompleto depende dos timestamps canônicos e omite a
 * duração, em vez de continuar envelhecendo depois de reload ou remount.
 */
export function resolveThinkingTiming(
  segments: readonly MessageSegment[],
  live: boolean,
  turnStartedAt: number,
  liveElapsed: number,
): ThinkingTiming {
  return {
    inFlight: live,
    duration: live ? Math.max(0, liveElapsed) : segmentsReasoningDuration(segments, turnStartedAt),
  };
}
