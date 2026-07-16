import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import {
  approveChatAction,
  clearConversation,
  getChatSnapshot,
  type ChatStreamEvent,
} from '../lib/chat/runtime';
import {
  cancelActiveChatTurn,
  ChatTurnBusyError,
  createChatTurn,
  recoverOrphanedUserTurn,
  runChatTurn,
} from '../lib/chat/turn-runtime';

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
  const query = z
    .object({
      before: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .safeParse(c.req.query());
  if (!query.success) return c.json({ error: 'Paginação inválida.' }, 400);
  const userId = c.get('userId');
  if (!query.data.before) {
    const turnId = await recoverOrphanedUserTurn(userId);
    if (turnId) void runChatTurn(turnId).catch(() => undefined);
  }
  let snapshot: Awaited<ReturnType<typeof getChatSnapshot>>;
  try {
    snapshot = await getChatSnapshot(userId, query.data);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Não foi possível carregar o chat.' },
      400,
    );
  }
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
    hasOlder: snapshot.hasOlder,
    nextCursor: snapshot.nextCursor,
    activeTurn: snapshot.activeTurn
      ? { ...snapshot.activeTurn, updatedAt: snapshot.activeTurn.updatedAt.toISOString() }
      : null,
  });
});

chatRoutes.delete('/', async (c) => {
  const userId = c.get('userId');
  await cancelActiveChatTurn(userId);
  await clearConversation(userId);
  return c.json({ ok: true });
});

chatRoutes.post('/cancel', async (c) => {
  return c.json({ cancelled: await cancelActiveChatTurn(c.get('userId')) });
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
  let turn: Awaited<ReturnType<typeof createChatTurn>>;
  try {
    turn = await createChatTurn(userId, parsed.data.content);
  } catch (error) {
    if (error instanceof ChatTurnBusyError) return c.json({ error: error.message }, 409);
    throw error;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const emit = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encodeSse(event));
        } catch {
          // A conexão é somente observadora; o turno durável continua no servidor.
          open = false;
        }
      };
      emit({ type: 'status', label: 'Preparando resposta…' });
      void runChatTurn(turn.id, emit)
        .catch((error: unknown) => {
          emit({
            type: 'error',
            message: error instanceof Error ? error.message : 'Falha inesperada no chat.',
          });
        })
        .finally(() => {
          if (!open) return;
          try {
            controller.close();
          } catch {
            // Cliente desconectado; o resultado já foi persistido pelo turno.
          }
        });
    },
    cancel() {
      // Fechar ou colocar o PWA em background não cancela o processamento.
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
