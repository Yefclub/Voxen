import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import {
  approveChatAction,
  acquireChatStreamSlot,
  getChatSnapshot,
  getOrCreateConversation,
  releaseChatStreamSlot,
  streamAssistantReply,
  type ChatStreamEvent,
} from '../lib/chat/runtime';

type Vars = { userId: string };

export const chatRoutes = new Hono<{ Variables: Vars }>();

chatRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') return c.json({ error: 'Acesso negado.' }, 403);
  c.set('userId', session.user.id);
  return next();
});

chatRoutes.get('/', async (c) => {
  const snapshot = await getChatSnapshot(c.get('userId'));
  return c.json({
    conversation: {
      id: snapshot.conversation.id,
      compactionCount: snapshot.conversation.compactionCount,
      updatedAt: snapshot.conversation.updatedAt,
    },
    messages: snapshot.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
      compactedAt: message.compactedAt?.toISOString() ?? null,
    })),
  });
});

const SendBody = z.object({ content: z.string().trim().min(1).max(20_000) });

function encodeSse(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

chatRoutes.post('/', async (c) => {
  const parsed = SendBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Mensagem inválida.' }, 400);
  const userId = c.get('userId');
  const quota = await rateLimit(`voxen:rl:chat:${userId}`, 12, 60);
  if (!quota.allowed) {
    return c.json(
      { error: 'Muitas mensagens em pouco tempo. Tente novamente em instantes.' },
      429,
      { 'Retry-After': String(quota.resetIn) },
    );
  }
  const streamOwnerId = await acquireChatStreamSlot(userId);
  if (!streamOwnerId) {
    return c.json({ error: 'Uma resposta já está em andamento. Aguarde a conclusão.' }, 409);
  }
  let conversation: Awaited<ReturnType<typeof getOrCreateConversation>>;
  try {
    conversation = await getOrCreateConversation(userId);
  } catch (error) {
    await releaseChatStreamSlot(userId, streamOwnerId).catch(() => undefined);
    throw error;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ChatStreamEvent) => controller.enqueue(encodeSse(event));
      void streamAssistantReply({
        userId,
        conversationId: conversation.id,
        content: parsed.data.content,
        abortSignal: c.req.raw.signal,
        emit,
      })
        .catch((error: unknown) => {
          emit({
            type: 'error',
            message: error instanceof Error ? error.message : 'Falha inesperada no chat.',
          });
        })
        .finally(async () => {
          await releaseChatStreamSlot(userId, streamOwnerId).catch(() => undefined);
          controller.close();
        });
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

const ApprovalBody = z.object({ approvalId: z.string().uuid() });

chatRoutes.post('/approve', async (c) => {
  const parsed = ApprovalBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Confirmação inválida.' }, 400);
  try {
    return c.json(await approveChatAction(c.get('userId'), parsed.data.approvalId));
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Não foi possível confirmar.' },
      400,
    );
  }
});
