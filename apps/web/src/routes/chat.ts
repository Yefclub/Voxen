// ============================================================================
// /api/chat — proxy autenticado para o serviço chat (FastAPI)
// ============================================================================
// O cliente envia { messages: [{role, content}, ...] }. Pegamos a sessão
// via better-auth, injetamos X-Voxen-User-Id no upstream e fazemos
// pipe do SSE de volta pro browser. O serviço chat decifra a chave do OR
// via master key e roda o tool-calling loop.
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';

export const chatRoutes = new Hono();

chatRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  // @ts-expect-error — passamos o userId via header customizado no upstream
  c.set('userId', session.user.id);
  return next();
});

chatRoutes.post('/', async (c) => {
  const userId = (c.get as (k: string) => string)('userId');
  const upstreamUrl = (process.env.CHAT_SERVICE_URL ?? 'http://chat:8001') + '/chat';
  const body = await c.req.text();

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Voxen-User-Id': userId,
      Accept: 'text/event-stream',
    },
    body,
  });

  if (!upstream.ok && upstream.headers.get('content-type')?.includes('application/json')) {
    const errBody = await upstream.json().catch(() => ({ error: 'Chat service erro.' }));
    return c.json(errBody, upstream.status as 200);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});
