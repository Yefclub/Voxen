import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import type { MessageAttachment } from './message-attachments';
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

export async function createChatTurn(
  userId: string,
  content: string,
  attachments: readonly MessageAttachment[] = [],
) {
  const conversation = await getOrCreateConversation(userId);
  return db.$transaction(async (tx) => {
    const claimed = await tx.conversation.updateMany({
      where: { id: conversation.id, userId, thinking: false },
      data: { thinking: true, updatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ChatTurnBusyError();

    const userMessage = await tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content,
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
      },
      select: { id: true },
    });
    return tx.chatTurn.create({
      data: {
        userId,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
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
      select: { content: true },
    });
    if (!userMessage) throw new Error('A mensagem original do turno não foi encontrada.');

    await db.$transaction([
      db.chatTurn.update({
        where: { id: turn.id },
        data: { status: 'RUNNING', errorMsg: null },
      }),
      db.conversation.update({
        where: { id: turn.conversationId },
        data: { thinking: true },
      }),
    ]);

    const runtimeStartedAt = Date.now();
    await streamAssistantReply({
      userId: turn.userId,
      conversationId: turn.conversationId,
      content: userMessage.content,
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

  const latest = await db.chatMessage.findFirst({
    where: { conversationId: conversation.id, compactedAt: null, kind: 'NORMAL' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, role: true },
  });
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
        },
        select: { id: true },
      });
      const turn = await tx.chatTurn.create({
        data: {
          userId,
          conversationId: conversation.id,
          userMessageId: latest.id,
          assistantMessageId: assistant.id,
        },
        select: { id: true },
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { thinking: true } });
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
