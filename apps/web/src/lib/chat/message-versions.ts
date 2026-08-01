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
import { planLinearization, resolveDeepestLeaf } from './message-trail';

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

/**
 * Folha que a conversa passa a apontar ao ativar uma versão: o descendente
 * mais profundo dela, escolhendo em cada bifurcação o ramo mais recente.
 * Navegar entre versões NUNCA gera resposta nova — só reposiciona a trilha.
 */
export async function resolveActivationLeaf(
  target: OwnedMessageRow,
  findNodes?: TrailNodeFinder,
): Promise<string> {
  const { nodes } = await loadConversationTrail(target.conversationId, null, findNodes);
  return resolveDeepestLeaf(nodes, target.id) ?? target.id;
}

export interface ActivateVersionDeps {
  findMessage?: OwnedMessageFinder;
  findNodes?: TrailNodeFinder;
  isThinking?: (conversationId: string) => Promise<boolean>;
  setActiveLeaf?: (conversationId: string, activeLeafId: string) => Promise<unknown>;
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
  const thinking = await (deps.isThinking ?? isConversationThinking)(target.conversationId);
  // Enquanto uma resposta está sendo gerada, trocar de trilha deixaria o turno
  // em andamento gravando num ramo que o usuário não está mais vendo.
  if (thinking) {
    throw new MessageVersionError('Aguarde a resposta atual terminar.', 409);
  }
  const activeLeafId = await resolveActivationLeaf(target, deps.findNodes);
  await (deps.setActiveLeaf ?? setConversationActiveLeaf)(target.conversationId, activeLeafId);
  return { conversationId: target.conversationId, activeLeafId };
}

async function isConversationThinking(conversationId: string): Promise<boolean> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { thinking: true },
  });
  return conversation?.thinking ?? false;
}

function setConversationActiveLeaf(conversationId: string, activeLeafId: string): Promise<unknown> {
  return db.conversation.update({ where: { id: conversationId }, data: { activeLeafId } });
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
export async function ensureConversationLinearized(
  conversationId: string,
  nodes: readonly TrailNodeRow[],
  updateParent: (id: string, parentId: string) => Promise<unknown> = (id, parentId) =>
    db.chatMessage.updateMany({
      where: { id, conversationId, parentId: null },
      data: { parentId },
    }),
): Promise<number> {
  const plan = planLinearization(nodes);
  for (const step of plan) await updateParent(step.id, step.parentId);
  return plan.length;
}
