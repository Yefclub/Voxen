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
import { ApprovalBody } from '../lib/chat/approval-input';
import { MAX_MESSAGE_ATTACHMENTS } from '../lib/chat/message-attachments';
import { resolveAttachments } from '../lib/chat/attachment-resolver';
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

const SendBody = z.object({
  content: z.string().trim().min(1).max(20_000),
  // O cliente só informa QUAIS jobs de upload acompanham a mensagem. Nome e
  // tipo do anexo são resolvidos no servidor (spec 126).
  attachmentJobIds: z.array(z.string().min(1).max(64)).max(MAX_MESSAGE_ATTACHMENTS).optional(),
});

/** Comentário SSE a cada ~15s de ociosidade (spec 065 + Bun idleTimeout). */
export const CHAT_SSE_KEEPALIVE_MS = 15_000;
const KEEPALIVE_BYTES = new TextEncoder().encode(': keepalive\n\n');

function encodeSse(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

chatRoutes.post('/', async (c) => {
  const requestStartedAt = Date.now();
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
  const attachments = await resolveAttachments(userId, parsed.data.attachmentJobIds);
  let turn: Awaited<ReturnType<typeof createChatTurn>>;
  try {
    turn = await createChatTurn(userId, parsed.data.content, attachments);
  } catch (error) {
    if (error instanceof ChatTurnBusyError) return c.json({ error: error.message }, 409);
    throw error;
  }

  // Keepalive: Bun fecha conexões ociosas em 10s por padrão; Cloudflare em ~100s.
  // Durante request_transcription (minutos sem token de modelo) o stream morria e
  // o browser mostrava "network error" mesmo com a transcrição concluindo no servidor.
  let stopKeepalive: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

      const stop = (): void => {
        if (keepaliveTimer !== null) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      };
      stopKeepalive = stop;

      const armKeepalive = (): void => {
        stop();
        keepaliveTimer = setInterval(() => {
          if (!open) {
            stop();
            return;
          }
          try {
            controller.enqueue(KEEPALIVE_BYTES);
          } catch {
            open = false;
            stop();
          }
        }, CHAT_SSE_KEEPALIVE_MS);
      };

      const emit = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encodeSse(event));
          armKeepalive();
        } catch {
          // A conexão é somente observadora; o turno durável continua no servidor.
          open = false;
          stop();
        }
      };

      armKeepalive();
      emit({
        type: 'start',
        turnId: turn.id,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
        startedAt: turn.createdAt.toISOString(),
      });
      emit({
        type: 'status',
        code: 'preparing-response',
        label: 'Preparando resposta…',
      });
      void runChatTurn(turn.id, emit, { requestStartedAt })
        .catch((error: unknown) => {
          emit({
            type: 'error',
            message: error instanceof Error ? error.message : 'Falha inesperada no chat.',
          });
        })
        .finally(() => {
          stop();
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // Cliente desconectado; o resultado já foi persistido pelo turno.
          }
        });
    },
    cancel() {
      // Fechar ou colocar o PWA em background não cancela o processamento.
      stopKeepalive?.();
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
