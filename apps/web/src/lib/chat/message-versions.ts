// ============================================================================
// Versionamento de mensagens do usuário (spec 127)
// ----------------------------------------------------------------------------
// Fronteira de workspace. `userId` vem SEMPRE da sessão; o cliente só informa
// o id da mensagem. A busca resolve a mensagem pelo relacionamento
// `conversation: { userId }` — id de outra conversa simplesmente não é
// encontrado, em vez de deixar um usuário ler ou ativar a trilha de outro
// (CLAUDE.md § Isolamento de Workspaces).
//
// Por que as buscas são INJETÁVEIS: sem isso o escopo por `userId` ficaria
// coberto apenas por `toContain` no texto-fonte da rota — um grep, não um
// teste. Reescrever a query sem o filtro passava na suíte inteira. Com a
// injeção, `tests/chat-message-versions.test.ts` chama estas funções com um
// finder que emula o Postgres filtrando pelo `where` RECEBIDO: se o escopo
// sumir, a mensagem alheia passa a ser devolvida e o teste falha pelo
// retorno, não só pela asserção do `where`.
// ============================================================================

import { db } from '../db';
import {
  loadConversationTrail,
  type TrailNodeFinder,
  type TrailNodeRow,
} from './conversation-trail';
import { applyLinearization, planLinearization, resolveDeepestLeaf } from './message-trail';

/** Erro de versionamento com o status HTTP que a rota deve devolver. */
export class MessageVersionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MessageVersionError';
    this.status = status;
  }
}

export interface OwnedMessageRow {
  id: string;
  parentId: string | null;
  conversationId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
}

/**
 * Consulta emitida ao resolver a mensagem alvo. `conversation.userId` é
 * obrigatório no tipo — remover o escopo quebra o typecheck antes de virar
 * vazamento entre workspaces.
 */
export interface OwnedMessageQuery {
  where: { id: string; conversation: { userId: string } };
  select: { id: true; parentId: true; conversationId: true; role: true };
}

export type OwnedMessageFinder = (query: OwnedMessageQuery) => Promise<OwnedMessageRow | null>;

const findOwnedMessageInDb: OwnedMessageFinder = (query) =>
  db.chatMessage.findFirst(query) as unknown as Promise<OwnedMessageRow | null>;

/** Mensagem da conversa do próprio usuário, ou `null`. */
export async function findOwnedMessage(
  userId: string,
  messageId: string,
  findMessage: OwnedMessageFinder = findOwnedMessageInDb,
): Promise<OwnedMessageRow | null> {
  return findMessage({
    where: { id: messageId, conversation: { userId } },
    select: { id: true, parentId: true, conversationId: true, role: true },
  });
}

/**
 * Mensagem do usuário elegível a versionamento. Mensagem do assistente está
 * fora de escopo na spec 127, e mensagem de outro workspace não existe daqui.
 */
export async function resolveVersionTarget(
  userId: string,
  messageId: string,
  findMessage: OwnedMessageFinder = findOwnedMessageInDb,
): Promise<OwnedMessageRow> {
  const message = await findOwnedMessage(userId, messageId, findMessage);
  if (!message) throw new MessageVersionError('Mensagem não encontrada.', 404);
  if (message.role !== 'USER') {
    throw new MessageVersionError('Só é possível versionar uma mensagem sua.', 400);
  }
  return message;
}

export interface ActivateVersionDeps {
  findMessage?: OwnedMessageFinder;
  findNodes?: TrailNodeFinder;
  readState?: (conversationId: string) => Promise<{ messagesLinearized: boolean } | null>;
  linearize?: LinearizeDeps;
  /**
   * Grava a folha ativa SOMENTE se a conversa não estiver gerando resposta, e
   * devolve se gravou. Leitura e escrita têm que ser a mesma operação: um
   * turno que reivindique `thinking` entre as duas teria a trilha trocada por
   * baixo e montaria o prompt do ramo errado.
   */
  claimActiveLeaf?: (conversationId: string, activeLeafId: string) => Promise<boolean>;
}

/**
 * Troca a trilha exibida para a que passa pela versão escolhida. Não gera
 * resposta nova — só reposiciona o ponteiro de folha ativa da conversa.
 */
export async function activateMessageVersion(
  userId: string,
  messageId: string,
  deps: ActivateVersionDeps = {},
): Promise<{ conversationId: string; activeLeafId: string }> {
  const target = await resolveVersionTarget(userId, messageId, deps.findMessage);
  const conversationId = target.conversationId;
  const state = await (deps.readState ?? readConversationState)(conversationId);
  if (!state) throw new MessageVersionError('Mensagem não encontrada.', 404);

  // Ativar é escrita estrutural: sem encadear antes, numa conversa do acervo
  // antigo `resolveDeepestLeaf` não acha filho nenhum, a folha resolvida vira
  // a própria mensagem, e a trilha perde de forma PERSISTIDA tudo que veio
  // depois dela.
  const { nodes } = await loadConversationTrail(
    conversationId,
    { activeLeafId: null, linearized: state.messagesLinearized },
    deps.findNodes,
  );
  const linearNodes = await ensureConversationLinearized(
    nodes,
    state.messagesLinearized,
    deps.linearize ?? linearizeWith(conversationId, db),
  );

  const activeLeafId = resolveDeepestLeaf(linearNodes, target.id) ?? target.id;
  const claimed = await (deps.claimActiveLeaf ?? claimActiveLeafInDb)(conversationId, activeLeafId);
  if (!claimed) throw new MessageVersionError('Aguarde a resposta atual terminar.', 409);
  return { conversationId, activeLeafId };
}

async function readConversationState(
  conversationId: string,
): Promise<{ messagesLinearized: boolean } | null> {
  return db.conversation.findUnique({
    where: { id: conversationId },
    select: { messagesLinearized: true },
  });
}

async function claimActiveLeafInDb(conversationId: string, activeLeafId: string): Promise<boolean> {
  const claimed = await db.conversation.updateMany({
    where: { id: conversationId, thinking: false },
    data: { activeLeafId },
  });
  return claimed.count === 1;
}

/**
 * Antecessor de uma mensagem nova: a folha da trilha ativa. Enviar mensagem
 * estando numa trilha anexa ao FIM daquela trilha, nunca ao fim cronológico da
 * conversa — que numa árvore pode estar em outro ramo.
 */
export function resolveAppendParent(trail: readonly TrailNodeRow[]): string | null {
  return trail[trail.length - 1]?.id ?? null;
}

/**
 * Encadeia mensagens sem antecessor de uma conversa do acervo antigo antes de
 * qualquer escrita estrutural (novo turno, nova versão, compactação).
 *
 * Não é migração de deploy: é preguiçoso, por conversa e idempotente — roda no
 * máximo uma vez por conversa e vira no-op depois. Conversa que ninguém abre
 * nunca é tocada e continua legível pela regra de prefixo linear da trilha.
 */
export interface LinearizeDeps {
  updateParent: (id: string, parentId: string) => Promise<unknown>;
  markLinearized: () => Promise<unknown>;
}

/** Cliente Prisma (ou transação) reduzido ao que o encadeamento escreve. */
export interface LinearizeClient {
  chatMessage: {
    updateMany(args: {
      where: { id: string; conversationId: string; parentId: null };
      data: { parentId: string };
    }): Promise<unknown>;
  };
  conversation: {
    update(args: { where: { id: string }; data: { messagesLinearized: true } }): Promise<unknown>;
  };
}

export function linearizeWith(conversationId: string, client: LinearizeClient): LinearizeDeps {
  return {
    updateParent: (id, parentId) =>
      client.chatMessage.updateMany({
        where: { id, conversationId, parentId: null },
        data: { parentId },
      }),
    markLinearized: () =>
      client.conversation.update({
        where: { id: conversationId },
        data: { messagesLinearized: true },
      }),
  };
}

export async function ensureConversationLinearized<T extends TrailNodeRow>(
  nodes: readonly T[],
  alreadyLinearized: boolean,
  deps: LinearizeDeps,
): Promise<T[]> {
  if (alreadyLinearized) return [...nodes];
  const plan = planLinearization(nodes);
  for (const step of plan) await deps.updateParent(step.id, step.parentId);
  // A marca é gravada mesmo com plano vazio: conversa nova já nasce árvore, e
  // sem a marca a leitura continuaria aplicando a regra de acervo antigo.
  await deps.markLinearized();
  return applyLinearization(nodes, plan);
}
