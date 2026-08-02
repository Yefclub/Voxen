import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import {
  activeTrailMessages,
  loadConversationTrail,
  type TrailNodeRow,
} from './conversation-trail';
import type { MessageAttachment } from './message-attachments';
import { ensureConversationLinearized, linearizeWith, resolveTurnParent } from './message-versions';
import { getOrCreateConversation, streamAssistantReply, type ChatStreamEvent } from './runtime';
import {
  acquireChatTurnLease,
  CHAT_TURN_HEARTBEAT_MS,
  releaseChatTurnLease,
  renewChatTurnLease,
} from './turn-coordinator';

const activeControllers = new Map<string, AbortController>();

export class ChatTurnBusyError extends Error {
  constructor() {
    super('Uma resposta já está em andamento. Aguarde a conclusão.');
  }
}

export class ChatTurnCoordinationError extends Error {
  constructor() {
    super('O chat está temporariamente indisponível. Tente novamente em instantes.');
  }
}

/** A mensagem a versionar sumiu entre a checagem da rota e a transação. */
export class ChatTurnVersionTargetError extends Error {
  constructor() {
    super('Mensagem não encontrada.');
  }
}

export interface CreateChatTurnOptions {
  /**
   * Mensagem sendo versionada (spec 127). A nova versão nasce IRMÃ dela, ou
   * seja, pendurada no mesmo antecessor. Ausente = fluxo normal, que anexa ao
   * fim da trilha ativa.
   *
   * Guarda o ID, não o antecessor já resolvido: numa conversa legada
   * o antecessor só existe DEPOIS do encadeamento preguiçoso, que roda dentro
   * da transação abaixo. Ler `parentId` antes disso devolveria `null` e faria
   * a versão nascer como segunda raiz, jogando fora o histórico anterior.
   */
  branchFrom?: { messageId: string };
}

/**
 * Turno de resume pós-HITL (spec 132): anexa um assistente vazio na folha
 * HITL_RESPONSE e reutiliza essa mensagem como âncora do ChatTurn
 * (userMessageId). O `content` sintético de resume vai em `resumeContent` e é
 * lido por `runChatTurn` quando a âncora é HITL_RESPONSE.
 */
export async function createHitlResumeTurn(
  userId: string,
  args: { conversationId: string; hitlMessageId: string; resumeContent: string },
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
    const configRevision = await tx.configRevision.findFirst({
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    const claimed = await tx.conversation.updateMany({
      where: { id: args.conversationId, userId, thinking: false },
      data: { thinking: true, updatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ChatTurnBusyError();

    const hitl = await tx.chatMessage.findFirst({
      where: {
        id: args.hitlMessageId,
        conversationId: args.conversationId,
        kind: 'HITL_RESPONSE',
      },
      select: { id: true },
    });
    if (!hitl) throw new ChatTurnVersionTargetError();

    // Guarda o prompt de resume no content da âncora HITL (já visível ao user
    // como confirmação) — append de bloco interno só no runtime via kind check
    // + meta em content seria ruidoso. Em vez disso: criamos um USER sintético
    // oculto? Preferimos guardar resumeContent em ChatTurn não existe.
    // Solução: criar ASSISTANT e turn com userMessageId = hitl; runChatTurn
    // detecta kind HITL_RESPONSE e usa buildHitlResumePrompt a partir do
    // content legível da âncora (já tem título). O resumeContent é repassado
    // gravando temporariamente no content da âncora? Não sobrescrever.
    //
    // Persistimos o prompt em um campo JSON via mensagem SYSTEM irmã? Overkill.
    // Usamos `resumeContent` gravado no `errorMsg`? No.
    //
    // Implementação: criar USER message com content=resumeContent e
    // role USER, mas kind NORMAL, e o frontend filtra content que começa com
    // o prefixo interno. Hmm.
    //
    // Melhor: criar a mensagem USER com content=resumeContent e parent=hitl;
    // assistant com parent=user. A UI mostra o USER — ruim.
    //
    // Aceito: assistant parent=hitl; turn.userMessageId=hitl.id;
    // runChatTurn usa content override se a mensagem âncora for HITL_RESPONSE,
    // reconstruindo o prompt a partir do content da HITL (parse título).
    const assistantMessage = await tx.chatMessage.create({
      data: {
        conversationId: args.conversationId,
        role: 'ASSISTANT',
        content: '',
        tools: [],
        segments: [],
        parentId: hitl.id,
      },
      select: { id: true },
    });
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: { activeLeafId: assistantMessage.id },
    });
    // Persist resume prompt on a dedicated SYSTEM sibling? Use tools null and
    // store in conversation? Store as ChatMessage with kind HITL_RESPONSE
    // content unchanged; pass resumeContent via in-memory map keyed by turnId.
    const turn = await tx.chatTurn.create({
      data: {
        userId,
        conversationId: args.conversationId,
        userMessageId: hitl.id,
        assistantMessageId: assistantMessage.id,
        configRevisionId: configRevision?.id,
      },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        userMessageId: true,
        assistantMessageId: true,
        status: true,
        createdAt: true,
      },
    });
    resumePromptByTurnId.set(turn.id, args.resumeContent);
    return turn;
  });
}

/** Prompts de resume injetados no create (não cabem no schema do ChatTurn). */
const resumePromptByTurnId = new Map<string, string>();

export function takeResumePromptForTurn(turnId: string): string | null {
  const value = resumePromptByTurnId.get(turnId) ?? null;
  if (value !== null) resumePromptByTurnId.delete(turnId);
  return value;
}

/** Test helper — seed a resume prompt without creating a DB turn. */
export function setResumePromptForTurnForTests(turnId: string, prompt: string): void {
  resumePromptByTurnId.set(turnId, prompt);
}

export async function createChatTurn(
  userId: string,
  content: string,
  attachments: readonly MessageAttachment[] = [],
  options: CreateChatTurnOptions = {},
) {
  const conversation = await getOrCreateConversation(userId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
    const configRevision = await tx.configRevision.findFirst({
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    const claimed = await tx.conversation.updateMany({
      where: { id: conversation.id, userId, thinking: false },
      data: { thinking: true, updatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ChatTurnBusyError();

    // Posição na árvore resolvida DENTRO da transação que já segurou o
    // `thinking`, e com o ponteiro RELIDO aqui: o valor lido junto da conversa,
    // antes da reivindicação, pode ter envelhecido se outro turno completou
    // nesse intervalo — e usá-lo penduraria a mensagem numa folha antiga,
    // criando um ramo que o usuário não pediu.
    const claimedConversation = await tx.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { activeLeafId: true, messagesLinearized: true },
    });
    const { nodes, trail } = await loadConversationTrail(
      conversation.id,
      {
        activeLeafId: claimedConversation.activeLeafId,
        linearized: claimedConversation.messagesLinearized,
      },
      (query) => tx.chatMessage.findMany(query) as unknown as Promise<TrailNodeRow[]>,
    );
    const linearNodes = await ensureConversationLinearized(
      nodes,
      claimedConversation.messagesLinearized,
      linearizeWith(conversation.id, tx),
    );

    // Antecessor resolvido DEPOIS do encadeamento e dentro desta transação: é
    // o que faz a versão nascer irmã de verdade, mesmo em conversa antiga.
    const resolved = resolveTurnParent(linearNodes, trail, options.branchFrom);
    if (!resolved.ok) throw new ChatTurnVersionTargetError();
    const parentId = resolved.parentId;

    const userMessage = await tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content,
        parentId,
        // Vínculo do anexo com a mensagem (spec 126): já normalizado e com
        // dono verificado pelo chamador; persistir aqui é o que faz o anexo
        // sobreviver ao reload.
        ...(attachments.length > 0
          ? { attachments: attachments as unknown as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true },
    });
    const assistantMessage = await tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: '',
        tools: [],
        segments: [],
        parentId: userMessage.id,
      },
      select: { id: true },
    });
    // A trilha ativa passa a terminar na resposta deste turno — inclusive
    // quando o turno nasceu de uma versão nova.
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { activeLeafId: assistantMessage.id },
    });
    return tx.chatTurn.create({
      data: {
        userId,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        configRevisionId: configRevision?.id,
      },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        userMessageId: true,
        assistantMessageId: true,
        status: true,
        createdAt: true,
      },
    });
  });
}

export async function runChatTurn(
  turnId: string,
  emit: (event: ChatStreamEvent) => void = () => undefined,
  timing?: { requestStartedAt?: number },
): Promise<boolean> {
  const claimStartedAt = Date.now();
  const ownerId = crypto.randomUUID();
  let acquired = false;
  try {
    acquired = await acquireChatTurnLease(turnId, ownerId);
  } catch {
    throw new ChatTurnCoordinationError();
  }
  if (!acquired) return false;

  const controller = new AbortController();
  activeControllers.set(turnId, controller);
  let leaseLost = false;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void Promise.all([
      renewChatTurnLease(turnId, ownerId),
      db.chatTurn.updateMany({
        where: { id: turnId, status: 'RUNNING' },
        data: { updatedAt: new Date() },
      }),
    ])
      .then(([renewed]) => {
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      })
      .catch(() => {
        leaseLost = true;
        controller.abort();
      })
      .finally(() => {
        heartbeatBusy = false;
      });
  }, CHAT_TURN_HEARTBEAT_MS);

  try {
    const turn = await db.chatTurn.findUnique({
      where: { id: turnId },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        userMessageId: true,
        assistantMessageId: true,
        status: true,
        createdAt: true,
      },
    });
    if (
      !turn ||
      turn.status === 'DONE' ||
      turn.status === 'FAILED' ||
      turn.status === 'CANCELLED'
    ) {
      return false;
    }
    const userMessage = await db.chatMessage.findUnique({
      where: { id: turn.userMessageId },
      select: { content: true, kind: true },
    });
    if (!userMessage) throw new Error('A mensagem original do turno não foi encontrada.');

    await db.$transaction(async (tx) => {
      // Captura a revisão no começo efetivo do runtime, imediatamente antes
      // de o chat ler modelo e credenciais globais.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
      const revision = await tx.configRevision.findFirst({
        orderBy: { number: 'desc' },
        select: { id: true },
      });
      await Promise.all([
        tx.chatTurn.update({
          where: { id: turn.id },
          data: { status: 'RUNNING', errorMsg: null, configRevisionId: revision?.id },
        }),
        tx.conversation.update({
          where: { id: turn.conversationId },
          data: { thinking: true },
        }),
      ]);
    });

    // Resume HITL (spec 132): âncora é HITL_RESPONSE; o prompt sintético foi
    // registrado em createHitlResumeTurn. Fallback reconstrói a partir do texto
    // da confirmação se o processo reiniciou (map em memória perdido).
    let turnContent = userMessage.content;
    if (userMessage.kind === 'HITL_RESPONSE') {
      turnContent =
        takeResumePromptForTurn(turn.id) ??
        `O usuário confirmou a ação. ${userMessage.content} Continue o plano anterior de forma natural, sem re-propor a mesma ação.`;
    }

    const runtimeStartedAt = Date.now();
    await streamAssistantReply({
      userId: turn.userId,
      conversationId: turn.conversationId,
      content: turnContent,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      abortSignal: controller.signal,
      emit,
      requestStartedAt: timing?.requestStartedAt ?? turn.createdAt.getTime(),
      claimStartedAt,
      runtimeStartedAt,
      turnCreatedAt: turn.createdAt,
    });

    const latest = await db.chatTurn.findUnique({
      where: { id: turn.id },
      select: { status: true },
    });
    if (latest?.status === 'CANCELLED') {
      await db.chatMessage.updateMany({
        where: { id: turn.assistantMessageId },
        data: { content: 'Resposta cancelada.' },
      });
    } else if (leaseLost) {
      await db.$transaction([
        db.chatTurn.update({
          where: { id: turn.id },
          data: { status: 'PENDING', errorMsg: null },
        }),
        db.chatMessage.update({
          where: { id: turn.assistantMessageId },
          data: { content: '', tools: [], segments: [] },
        }),
      ]);
    } else {
      await db.chatTurn.update({
        where: { id: turn.id },
        data: { status: 'DONE', finishedAt: new Date(), errorMsg: null },
      });
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no chat.';
    const turn = await db.chatTurn.findUnique({
      where: { id: turnId },
      select: { status: true, assistantMessageId: true },
    });
    if (turn && turn.status !== 'CANCELLED' && !leaseLost) {
      await db.$transaction([
        db.chatTurn.update({
          where: { id: turnId },
          data: { status: 'FAILED', errorMsg: message, finishedAt: new Date() },
        }),
        db.chatMessage.update({
          where: { id: turn.assistantMessageId },
          data: { content: message, tools: [], segments: [] },
        }),
      ]);
      emit({ type: 'error', message });
      emit({ type: 'done', messageId: turn.assistantMessageId });
    }
    return false;
  } finally {
    clearInterval(heartbeat);
    activeControllers.delete(turnId);
    const turn = await db.chatTurn.findUnique({
      where: { id: turnId },
      select: { conversationId: true, status: true },
    });
    if (turn && turn.status !== 'PENDING' && turn.status !== 'RUNNING') {
      await db.conversation
        .update({ where: { id: turn.conversationId }, data: { thinking: false } })
        .catch(() => undefined);
    }
    await releaseChatTurnLease(turnId, ownerId).catch(() => false);
  }
}

export async function cancelActiveChatTurn(userId: string): Promise<boolean> {
  const turn = await db.chatTurn.findFirst({
    where: { userId, status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, conversationId: true, assistantMessageId: true },
  });
  if (!turn) return false;
  await db.$transaction([
    db.chatTurn.update({
      where: { id: turn.id },
      data: { status: 'CANCELLED', errorMsg: 'Cancelado pelo usuário.', finishedAt: new Date() },
    }),
    db.chatMessage.update({
      where: { id: turn.assistantMessageId },
      data: { content: 'Resposta cancelada.', tools: [], segments: [] },
    }),
    db.conversation.update({ where: { id: turn.conversationId }, data: { thinking: false } }),
  ]);
  activeControllers.get(turn.id)?.abort();
  return true;
}

/** Recria o turno quando uma versão anterior persistiu o USER mas caiu antes da resposta. */
export async function recoverOrphanedUserTurn(userId: string): Promise<string | null> {
  const conversation = await getOrCreateConversation(userId);
  const active = await db.chatTurn.findFirst({
    where: { userId, conversationId: conversation.id, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  });
  if (active) return active.id;

  // "Última mensagem" é a folha da TRILHA ATIVA (spec 127), não a última por
  // `createdAt`: numa árvore a mensagem mais recente pode estar num ramo
  // abandonado, e recuperar o turno dela responderia à pergunta errada.
  const { trail } = await loadConversationTrail(conversation.id, {
    activeLeafId: conversation.activeLeafId,
    linearized: conversation.messagesLinearized,
  });
  const latest = activeTrailMessages(trail, { onlyNormalKind: true }).at(-1) ?? null;
  if (!latest || latest.role !== 'USER') {
    if (conversation && active === null) {
      await db.conversation.updateMany({
        where: { id: conversation.id, thinking: true },
        data: { thinking: false },
      });
    }
    return null;
  }

  try {
    return await db.$transaction(async (tx) => {
      // O turno recuperado é uma nova execução e deve capturar o mesmo corte
      // lógico de configuração usado por turnos criados normalmente.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
      const configRevision = await tx.configRevision.findFirst({
        orderBy: { number: 'desc' },
        select: { id: true },
      });
      const existing = await tx.chatTurn.findFirst({
        where: {
          userId,
          conversationId: conversation.id,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        select: { id: true },
      });
      if (existing) return existing.id;
      const assistant = await tx.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: '',
          tools: [],
          segments: [],
          parentId: latest.id,
        },
        select: { id: true },
      });
      const turn = await tx.chatTurn.create({
        data: {
          userId,
          conversationId: conversation.id,
          userMessageId: latest.id,
          assistantMessageId: assistant.id,
          configRevisionId: configRevision?.id,
        },
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { thinking: true, activeLeafId: assistant.id },
      });
      return turn.id;
    });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'P2002')) throw error;
    const winner = await db.chatTurn.findUnique({
      where: { userMessageId: latest.id },
      select: { id: true },
    });
    if (!winner) throw error;
    return winner.id;
  }
}

export async function reconcilePendingChatTurns(): Promise<number> {
  const turns = await db.chatTurn.findMany({
    where: { status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { updatedAt: 'asc' },
    take: 20,
    select: { id: true },
  });
  for (const turn of turns) void runChatTurn(turn.id).catch(() => undefined);
  return turns.length;
}
