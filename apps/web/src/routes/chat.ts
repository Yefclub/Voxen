// ============================================================================
// /api/chat — conversas persistidas + proxy SSE para o serviço chat
// ============================================================================
// Endpoints:
//  GET    /api/chat/conversations           lista conversas do user
//  POST   /api/chat/conversations           cria nova conversa
//  GET    /api/chat/conversations/:id       conversa + mensagens
//  PATCH  /api/chat/conversations/:id       renomear / toggle thinking
//  DELETE /api/chat/conversations/:id       apaga
//  POST   /api/chat/conversations/:id/send  envia mensagem (SSE)
//  POST   /api/chat/voice                   transcreve áudio do mic → texto
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';

// Limites do endpoint /voice — limite Whisper da OpenAI é 25 MB;
// allowlist cobre formatos que MediaRecorder produz nos browsers.
const VOICE_MAX_BYTES = 25 * 1024 * 1024;
const VOICE_MAX_PER_HOUR = 30;
const VOICE_ALLOWED_MIMES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
]);

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

function userId(c: { get: (k: string) => unknown }): string {
  return c.get('userId') as string;
}

function chatUrl(path: string): string {
  return (process.env.CHAT_SERVICE_URL ?? 'http://chat:8001') + path;
}

// ----------------------------------------------------------------------------
// Conversations CRUD
// ----------------------------------------------------------------------------

chatRoutes.get('/conversations', async (c) => {
  const uid = userId(c);
  const list = await db.conversation.findMany({
    where: { userId: uid, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      thinking: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
    take: 100,
  });
  return c.json({
    conversations: list.map((co) => ({
      id: co.id,
      title: co.title,
      thinking: co.thinking,
      updatedAt: co.updatedAt.toISOString(),
      createdAt: co.createdAt.toISOString(),
      messageCount: co._count.messages,
    })),
  });
});

chatRoutes.post('/conversations', async (c) => {
  const uid = userId(c);
  const body = (await c.req.json().catch(() => ({}))) as { title?: string };
  const conv = await db.conversation.create({
    data: {
      userId: uid,
      title: body.title?.trim() || 'Nova conversa',
    },
    select: { id: true, title: true, thinking: true, updatedAt: true, createdAt: true },
  });
  return c.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      thinking: conv.thinking,
      updatedAt: conv.updatedAt.toISOString(),
      createdAt: conv.createdAt.toISOString(),
      messageCount: 0,
    },
  });
});

chatRoutes.get('/conversations/:id', async (c) => {
  const uid = userId(c);
  const id = c.req.param('id');
  const conv = await db.conversation.findFirst({
    where: { id, userId: uid },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);
  return c.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      thinking: conv.thinking,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    },
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role.toLowerCase(),
      content: m.content,
      tools: m.tools as unknown,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

chatRoutes.patch('/conversations/:id', async (c) => {
  const uid = userId(c);
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    thinking?: boolean;
  };
  const conv = await db.conversation.findFirst({ where: { id, userId: uid } });
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);
  const updated = await db.conversation.update({
    where: { id },
    data: {
      ...(typeof body.title === 'string' ? { title: body.title.trim().slice(0, 120) } : {}),
      ...(typeof body.thinking === 'boolean' ? { thinking: body.thinking } : {}),
    },
    select: { id: true, title: true, thinking: true, updatedAt: true },
  });
  return c.json({
    conversation: {
      id: updated.id,
      title: updated.title,
      thinking: updated.thinking,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

chatRoutes.delete('/conversations/:id', async (c) => {
  const uid = userId(c);
  const id = c.req.param('id');
  const conv = await db.conversation.findFirst({ where: { id, userId: uid } });
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);
  await db.conversation.delete({ where: { id } });
  return c.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Send message → SSE stream do chat service
// ----------------------------------------------------------------------------

chatRoutes.post('/conversations/:id/send', async (c) => {
  const uid = userId(c);
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { content?: string };
  const content = body.content?.trim();
  if (!content) return c.json({ error: 'Mensagem vazia.' }, 400);

  const conv = await db.conversation.findFirst({
    where: { id, userId: uid },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);

  // Persiste mensagem do usuário antes de chamar o agente.
  await db.chatMessage.create({
    data: { conversationId: id, role: 'USER', content },
  });

  // Bumpa updatedAt e (se for a primeira) define um título auto.
  await db.conversation.update({
    where: { id },
    data: {
      updatedAt: new Date(),
      ...(conv.messages.length === 0 && conv.title === 'Nova conversa'
        ? { title: content.slice(0, 60) }
        : {}),
    },
  });

  const history = [
    ...conv.messages.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
    { role: 'user', content },
  ];

  // AbortController liga downstream → upstream. Se o client cancelar (fechar
  // aba, navegar), abortamos a conexão com chat:8001 em vez de deixar pendurada.
  const upstreamAbort = new AbortController();
  const upstream = await fetch(chatUrl('/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Voxen-User-Id': uid,
      'X-Voxen-Conversation-Id': id,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ messages: history, thinking: conv.thinking }),
    signal: upstreamAbort.signal,
  });

  if (!upstream.ok && upstream.headers.get('content-type')?.includes('application/json')) {
    const errBody = await upstream.json().catch(() => ({ error: 'Chat service erro.' }));
    return c.json(errBody, upstream.status as 200);
  }

  // Pipe SSE de volta MAS interceptando para persistir resposta final.
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let assistantContent = '';
  const tools: Array<{ name: string; preview?: string }> = [];

  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        if (assistantContent.trim() || tools.length > 0) {
          try {
            await db.chatMessage.create({
              data: {
                conversationId: id,
                role: 'ASSISTANT',
                content: assistantContent,
                tools: tools.length > 0 ? tools : undefined,
              },
            });
            await db.conversation.update({
              where: { id },
              data: { updatedAt: new Date() },
            });
          } catch {
            // Não interrompe o stream se persistência falhar.
          }
        }
        controller.close();
        return;
      }
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      controller.enqueue(encoder.encode(chunk));

      // Parse SSE blocks pra acumular content/tools.
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        const eventMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        try {
          const parsed = JSON.parse(dataMatch[1]!) as Record<string, unknown>;
          const ev = eventMatch[1];
          if (ev === 'token') assistantContent += (parsed.text as string) ?? '';
          else if (ev === 'tool_start') tools.push({ name: (parsed.name as string) ?? '' });
          else if (ev === 'tool_end' && tools.length > 0) {
            tools[tools.length - 1]!.preview = (parsed.preview as string) ?? '';
          }
        } catch {
          // ignora linhas malformadas
        }
      }
    },
    cancel(reason) {
      // Browser fechou a conexão. Cancela reader + aborta upstream pro chat
      // service detectar disconnect rápido (não esperar timeout próprio).
      reader.cancel(reason).catch(() => undefined);
      upstreamAbort.abort();
    },
  });

  return new Response(stream, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});

// ----------------------------------------------------------------------------
// Voice → text (proxy para o chat service)
// ----------------------------------------------------------------------------

chatRoutes.post('/voice', async (c) => {
  const uid = userId(c);

  // Rate limit por user — 30 transcrições por hora
  const rl = await rateLimit(`voxen:rl:voice:${uid}`, VOICE_MAX_PER_HOUR, 3600);
  if (!rl.allowed) {
    return c.json(
      {
        error: `Limite de ${VOICE_MAX_PER_HOUR} transcrições de voz por hora atingido. Tente em ${Math.ceil(rl.resetIn / 60)} min.`,
      },
      429,
    );
  }

  const form = await c.req.formData();
  const file = form.get('audio');
  if (!(file instanceof File)) {
    return c.json({ error: 'Arquivo de áudio ausente.' }, 400);
  }

  // Content-Type allowlist (anti-abuso: rejeita application/* etc)
  const declaredType = (file.type || '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (
    declaredType &&
    !VOICE_ALLOWED_MIMES.has(file.type.toLowerCase()) &&
    !VOICE_ALLOWED_MIMES.has(declaredType)
  ) {
    return c.json(
      { error: `Tipo de áudio não permitido: ${file.type}. Aceitos: webm, ogg, mp4, mpeg.` },
      415,
    );
  }

  // Cap de tamanho — Whisper aceita até 25 MB
  if (file.size > VOICE_MAX_BYTES) {
    return c.json(
      { error: `Áudio muito grande (${Math.round(file.size / 1024 / 1024)} MB). Máximo: 25 MB.` },
      413,
    );
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const upstream = await fetch(chatUrl('/voice-transcribe'), {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'audio/webm',
      'X-Voxen-User-Id': uid,
      'X-Voxen-Audio-Name': file.name || 'voice.webm',
    },
    body: buf,
  });
  const data = (await upstream.json().catch(() => ({}))) as { text?: string; detail?: string };
  if (!upstream.ok) {
    return c.json({ error: data.detail ?? 'Falha ao transcrever áudio.' }, upstream.status as 200);
  }
  return c.json({ text: data.text ?? '' });
});
