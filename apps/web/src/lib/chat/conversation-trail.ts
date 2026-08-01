// ============================================================================
// Carga da trilha ativa a partir do banco (spec 127)
// ----------------------------------------------------------------------------
// Ponto ÚNICO por onde toda leitura de histórico da conversa passa: snapshot da
// UI, histórico enviado ao modelo, compactação de memória e reconciliação de
// HITL. Replicar o filtro em cada chamador foi exatamente o padrão que a spec
// 127 aponta como o modo de falha mais caro — basta um esquecido para vazar
// mensagem de outra trilha para dentro do contexto do modelo.
//
// Por que a busca é INJETÁVEL (`findNodes`), no mesmo espírito de
// `attachment-resolver.ts`: sem isso a ordem da trilha só teria cobertura por
// `toContain` no texto-fonte — um grep, não um teste. Com a injeção,
// `tests/chat-message-trail.test.ts` executa a função com um finder que emula
// o Postgres e afirma o COMPORTAMENTO da trilha.
//
// Ordem das operações (importa): a caminhada roda sobre TODAS as mensagens da
// conversa, INCLUSIVE as compactadas, e só depois o resultado é filtrado por
// `compactedAt`. Filtrar antes quebraria a corrente de antecessores no ponto
// compactado e a trilha terminaria cedo, escondendo o histórico recente.
// ============================================================================

import { db } from '../db';
import {
  buildVersionGroups,
  resolveActiveTrail,
  type RoleTrailNode,
  type VersionGroup,
} from './message-trail';

/** Projeção leve: só o necessário para caminhar a árvore. */
export interface TrailNodeRow extends RoleTrailNode {
  kind: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
  compactedAt: Date | null;
}

/**
 * Consulta emitida pela carga. `conversationId` é obrigatório no tipo — a
 * conversa já vem resolvida a partir do `userId` da sessão, e remover o escopo
 * quebra o typecheck antes de virar vazamento entre workspaces.
 */
export interface TrailNodeQuery {
  where: { conversationId: string };
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }];
  select: {
    id: true;
    parentId: true;
    role: true;
    kind: true;
    compactedAt: true;
    createdAt: true;
  };
}

export type TrailNodeFinder = (query: TrailNodeQuery) => Promise<TrailNodeRow[]>;

const findTrailNodes: TrailNodeFinder = (query) =>
  db.chatMessage.findMany(query) as unknown as Promise<TrailNodeRow[]>;

export interface ConversationTrail {
  /** Todos os nós da conversa, para agrupar versões e localizar irmãs. */
  nodes: TrailNodeRow[];
  /** Trilha ativa da raiz até a folha, já na ordem da caminhada. */
  trail: TrailNodeRow[];
  versionGroups: Map<string, VersionGroup>;
}

/** Estado da conversa que a resolução da trilha precisa. */
export interface ConversationTrailState {
  activeLeafId: string | null | undefined;
  /** `Conversation.messagesLinearized`. Omitido = trata como acervo antigo. */
  linearized?: boolean;
}

export async function loadConversationTrail(
  conversationId: string,
  state: ConversationTrailState,
  findNodes: TrailNodeFinder = findTrailNodes,
): Promise<ConversationTrail> {
  const nodes = await findNodes({
    where: { conversationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      parentId: true,
      role: true,
      kind: true,
      compactedAt: true,
      createdAt: true,
    },
  });
  const options = { linearized: state.linearized };
  const trail = resolveActiveTrail(nodes, state.activeLeafId, options);
  return { nodes, trail, versionGroups: buildVersionGroups(nodes, trail, options) };
}

export interface ActiveTrailFilter {
  /** Mensagem em construção no turno corrente, que não entra no próprio prompt. */
  excludeId?: string | null;
  /** Snapshot da UI ignora o resumo de compactação; o modelo precisa dele. */
  onlyNormalKind?: boolean;
}

/**
 * Mensagens vivas da trilha, na ordem da caminhada. Compactada nunca volta —
 * seu conteúdo já está representado pelo resumo que ficou na mesma trilha.
 */
export function activeTrailMessages(
  trail: readonly TrailNodeRow[],
  filter: ActiveTrailFilter = {},
): TrailNodeRow[] {
  return trail.filter((node) => {
    if (node.compactedAt !== null) return false;
    if (filter.excludeId && node.id === filter.excludeId) return false;
    if (filter.onlyNormalKind && node.kind !== 'NORMAL') return false;
    return true;
  });
}

/** Ids na ordem da trilha — a ordem que o histórico enviado ao modelo precisa. */
export function activeTrailIds(
  trail: readonly TrailNodeRow[],
  filter: ActiveTrailFilter = {},
): string[] {
  return activeTrailMessages(trail, filter).map((node) => node.id);
}

/** Linha completa que vira mensagem no prompt do modelo. */
export interface HistoryRow {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  kind: 'NORMAL' | 'COMPACTION_SUMMARY' | 'HITL_RESPONSE';
  content: string;
  tools: unknown;
  segments: unknown;
  createdAt: Date;
}

export interface HistoryQuery {
  where: { id: { in: string[] }; conversationId: string };
  select: {
    id: true;
    role: true;
    kind: true;
    content: true;
    tools: true;
    segments: true;
    createdAt: true;
  };
}

export type HistoryFinder = (query: HistoryQuery) => Promise<HistoryRow[]>;

const findHistoryRows: HistoryFinder = (query) =>
  db.chatMessage.findMany(query) as unknown as Promise<HistoryRow[]>;

/**
 * Histórico enviado ao modelo: exatamente a trilha ativa, na ordem da
 * caminhada, sem as mensagens compactadas e sem a resposta que está sendo
 * escrita no turno corrente.
 *
 * Critério de aceite da spec 127 — "o histórico enviado ao modelo contém
 * apenas a trilha ativa" — é verificado executando ESTA função com finders
 * falsos em `tests/chat-message-trail.test.ts`. Ela é o único caminho pelo
 * qual `streamAssistantReply` monta o prompt, então o teste não é uma
 * reimplementação paralela da regra.
 */
export async function loadActiveHistory(
  conversationId: string,
  state: ConversationTrailState,
  options: { excludeId?: string | null } = {},
  deps: { findNodes?: TrailNodeFinder; findRows?: HistoryFinder } = {},
): Promise<HistoryRow[]> {
  const { trail } = await loadConversationTrail(conversationId, state, deps.findNodes);
  const orderedIds = activeTrailIds(trail, { excludeId: options.excludeId });
  if (orderedIds.length === 0) return [];
  const rows = await (deps.findRows ?? findHistoryRows)({
    where: { id: { in: orderedIds }, conversationId },
    select: {
      id: true,
      role: true,
      kind: true,
      content: true,
      tools: true,
      segments: true,
      createdAt: true,
    },
  });
  return orderByTrail(rows, orderedIds);
}

/**
 * Reordena linhas carregadas por id de volta para a ordem da trilha. Prisma
 * devolve `findMany({ id: { in } })` em ordem arbitrária, e numa árvore
 * `createdAt` não serve mais de desempate — a ordem é a da caminhada.
 */
export function orderByTrail<T extends { id: string }>(
  rows: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.id, row);
  const ordered: T[] = [];
  for (const id of orderedIds) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return ordered;
}
