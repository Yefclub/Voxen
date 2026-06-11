// ============================================================================
// /api/chat — conversas persistidas + proxy SSE para o serviço chat
// ============================================================================
// Endpoints:
//  GET    /api/chat/conversations           lista conversas do user
//  POST   /api/chat/conversations           cria nova conversa
//  GET    /api/chat/conversations/:id       conversa + mensagens
//  PATCH  /api/chat/conversations/:id       renomear / toggle thinking
//  DELETE /api/chat/conversations/:id       apaga
//  POST   /api/chat/conversations/:id/file-message registra upload feito no chat
//  POST   /api/chat/conversations/:id/send  envia mensagem (SSE)
//  POST   /api/chat/voice                   transcreve áudio do mic → texto
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import { getSetting } from '../lib/settings';
import { estimateMessagesTokens, getContextLimit } from '../lib/token-estimate';

// Limites do endpoint /voice — limite Whisper da OpenAI é 25 MB;
// allowlist cobre formatos que MediaRecorder produz nos browsers.
// Só listamos base types — split do ';codecs=...' faz a normalização.
const VOICE_MAX_BYTES = 25 * 1024 * 1024;
const VOICE_MAX_PER_HOUR = 30;
const VOICE_ALLOWED_MIMES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
]);
const MAX_LIBRARY_MENTIONS = 8;
const MAX_LIBRARY_MENTION_CHARS = 12_000;

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

interface LibraryMentionInput {
  type: 'transcript' | 'note';
  id: string;
  label?: string;
}

interface LibraryMentionContext {
  type: 'transcript' | 'note';
  id: string;
  label: string;
  subtitle?: string;
  content: string;
}

// Autocomplete de menções @ no chat. Só retorna itens do user autenticado.
chatRoutes.get('/library-mentions', async (c) => {
  const uid = userId(c);
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  const [transcripts, notes] = await Promise.all([
    db.transcript.findMany({
      where: {
        userId: uid,
        status: 'ACTIVE',
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { channel: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, source: true, channel: true },
      take: 6,
    }),
    db.note.findMany({
      where: {
        userId: uid,
        kind: 'NOTE',
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true },
      take: 6,
    }),
  ]);

  const items = [
    ...transcripts.map((t) => ({
      type: 'transcript' as const,
      id: t.id,
      label: t.title,
      subtitle: [t.source, t.channel].filter(Boolean).join(' · '),
    })),
    ...notes.map((n) => ({
      type: 'note' as const,
      id: n.id,
      label: n.title,
      subtitle: 'Nota',
    })),
  ].slice(0, 10);
  return c.json({ items });
});

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
  const includeCompacted = c.req.query('includeCompacted') === '1';
  const conv = await db.conversation.findFirst({
    where: { id, userId: uid },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        // Filtra mensagens compactadas por padrão — só mostra as ativas.
        // Cliente pode passar ?includeCompacted=1 pra ver histórico antigo.
        where: includeCompacted ? undefined : { compactedAt: null },
      },
    },
  });
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);
  // Estimativa de uso de contexto pra popular o ContextBar do Topbar
  // IMEDIATAMENTE ao abrir a conversa, sem esperar o user enviar nova
  // mensagem. O servidor já sabe o modelo configurado e tem as msgs
  // ativas em mão — basta espelhar o cálculo de tokens do chat service.
  const model = await getSetting('default_chat_model');
  const contents = conv.messages.map((m) => m.content);
  const tokensEstimate = estimateMessagesTokens(contents);
  const ctxLimit = getContextLimit(model);

  return c.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      thinking: conv.thinking,
      compactionCount: conv.compactionCount,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    },
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role.toLowerCase(),
      kind: m.kind,
      content: m.content,
      tools: m.tools as unknown,
      compactedAt: m.compactedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    contextUsage: { tokens: tokensEstimate, limit: ctxLimit },
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

chatRoutes.post('/conversations/:id/file-message', async (c) => {
  const uid = userId(c);
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    filename?: string;
    jobId?: string;
    kind?: string;
  };
  const filename = body.filename?.trim().slice(0, 160) || 'arquivo';
  const jobId = body.jobId?.trim() ?? '';
  if (!jobId) return c.json({ error: 'Job ausente.' }, 400);

  const [conv, job] = await Promise.all([
    db.conversation.findFirst({
      where: { id, userId: uid },
      select: { id: true, title: true, _count: { select: { messages: true } } },
    }),
    db.job.findFirst({
      where: { id: jobId, userId: uid },
      select: { id: true, type: true },
    }),
  ]);
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);
  if (!job) return c.json({ error: 'Job não encontrado.' }, 404);

  const label =
    job.type === 'UPLOAD_AND_TRANSCRIBE'
      ? 'arquivo de mídia'
      : job.type === 'UPLOAD_AND_ANALYZE_IMAGE'
        ? 'imagem'
        : 'documento';
  const userMessage = await db.chatMessage.create({
    data: {
      conversationId: id,
      role: 'USER',
      content: `Enviei o ${label} "${filename}" para análise.`,
    },
  });
  const assistantMessage = await db.chatMessage.create({
    data: {
      conversationId: id,
      role: 'ASSISTANT',
      content: `Recebi o ${label} e coloquei na fila. Acompanhe em [/jobs/${job.id}](/jobs/${job.id}).`,
    },
  });

  await db.conversation.update({
    where: { id },
    data: {
      updatedAt: new Date(),
      ...(conv._count.messages === 0 && conv.title === 'Nova conversa'
        ? { title: `Upload: ${filename}`.slice(0, 60) }
        : {}),
    },
  });

  return c.json({
    messages: [userMessage, assistantMessage].map((m) => ({
      id: m.id,
      role: m.role.toLowerCase(),
      kind: m.kind,
      content: m.content,
      tools: null,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ----------------------------------------------------------------------------
// Send message → SSE stream do chat service
// ----------------------------------------------------------------------------

chatRoutes.post('/conversations/:id/send', async (c) => {
  const uid = userId(c);
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: string;
    image_data_url?: string;
    mentions?: unknown;
    // Quando true, a mensagem é resposta de HITL via clique nos botões do
    // ConfirmationPrompt — marca kind=HITL_RESPONSE pra UI renderizar como
    // chip compacto em vez de bubble cheio (não polui a conversa).
    hitl?: boolean;
  };
  const content = body.content?.trim() ?? '';
  const imageDataUrl = body.image_data_url?.trim();
  const isHitl = body.hitl === true;
  // Aceita mensagem só com imagem (sem texto) — vision flow comum
  if (!content && !imageDataUrl) return c.json({ error: 'Mensagem vazia.' }, 400);
  // Cap servidor pra evitar payloads gigantes (≈5MB base64 + overhead)
  if (imageDataUrl && imageDataUrl.length > 7 * 1024 * 1024) {
    return c.json({ error: 'Imagem muito grande (limite 5MB).' }, 413);
  }
  if (imageDataUrl && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(imageDataUrl)) {
    return c.json({ error: 'Formato de imagem inválido.' }, 400);
  }

  const conv = await db.conversation.findFirst({
    where: { id, userId: uid },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        where: { compactedAt: null },
      },
    },
  });
  if (!conv) return c.json({ error: 'Conversa não encontrada.' }, 404);

  const libraryMentions = await resolveLibraryMentions(uid, body.mentions);

  // Texto persistido inclui marcador da imagem (UX: histórico mostra que
  // teve anexo). A data URL real fica no upstream pra economizar storage.
  const persistedContent =
    content + (imageDataUrl ? (content ? '\n\n📎 [imagem anexada]' : '📎 [imagem anexada]') : '');
  await db.chatMessage.create({
    data: {
      conversationId: id,
      role: 'USER',
      content: persistedContent,
      kind: isHitl ? 'HITL_RESPONSE' : 'NORMAL',
    },
  });

  // Bumpa updatedAt e (se for a primeira) define um título auto.
  await db.conversation.update({
    where: { id },
    data: {
      updatedAt: new Date(),
      ...(conv.messages.length === 0 && conv.title === 'Nova conversa'
        ? { title: (content || 'Imagem').slice(0, 60) }
        : {}),
    },
  });

  const history = [
    ...conv.messages.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
    { role: 'user', content: persistedContent },
  ];

  // Busca dados do user pra contexto do agente — name é exibido no system
  // prompt e tz reflete a data/hora real do user.
  // Name vai no BODY (não header) pra suportar nomes com unicode (CJK, emoji,
  // acentos extras): fetch valida headers como Latin-1 e lança em chars fora
  // dessa faixa, quebrando todo o chat pra esse user.
  const userInfo = await db.user.findUnique({
    where: { id: uid },
    select: { name: true },
  });
  const userTimezone = c.req.header('X-User-Timezone') ?? 'UTC';

  // AbortController liga downstream → upstream. Se o client cancelar (fechar
  // aba, navegar), abortamos a conexão com chat:8001 em vez de deixar pendurada.
  const upstreamAbort = new AbortController();
  const upstream = await fetch(chatUrl('/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Voxen-User-Id': uid,
      'X-Voxen-Conversation-Id': id,
      'X-Voxen-User-Timezone': userTimezone,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      messages: history,
      thinking: conv.thinking,
      user_name: userInfo?.name ?? '',
      ...(imageDataUrl ? { image_data_url: imageDataUrl } : {}),
      ...(libraryMentions.length > 0 ? { library_mentions: libraryMentions } : {}),
    }),
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
  const tools: PersistedTool[] = [];

  // Persiste o que foi acumulado até agora. Usado no done normal E em erros
  // do upstream — evita perder a mensagem parcial quando chat:8001 cai.
  const persistPartial = async (): Promise<void> => {
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
        // Best-effort
      }
    }
  };

  const stream = new ReadableStream({
    async pull(controller) {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        const r = await reader.read();
        value = r.value;
        done = r.done;
      } catch {
        // Upstream caiu/abortou. Persiste o parcial e fecha sem propagar erro
        // pro browser (o frontend já mostra o que recebeu até aqui).
        await persistPartial();
        controller.close();
        return;
      }
      if (done) {
        await persistPartial();
        controller.close();
        return;
      }
      const chunk = decoder.decode(value!, { stream: true });
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
          else if (ev === 'tool_start') {
            tools.push({
              name: (parsed.name as string) ?? '',
              args: sanitizeToolArgs(parsed.args),
            });
          } else if (ev === 'tool_end' && tools.length > 0) {
            const last = tools[tools.length - 1]!;
            last.preview = (parsed.preview as string) ?? '';
            if (typeof parsed.summary === 'string' && parsed.summary) {
              last.summary = parsed.summary.slice(0, 200);
            }
            const sources = sanitizeToolSources(parsed.sources);
            if (sources) last.sources = sources;
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

async function resolveLibraryMentions(uid: string, raw: unknown): Promise<LibraryMentionContext[]> {
  if (!Array.isArray(raw)) return [];
  const parsed: LibraryMentionInput[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_LIBRARY_MENTIONS)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type === 'note' ? 'note' : obj.type === 'transcript' ? 'transcript' : null;
    const id = typeof obj.id === 'string' ? obj.id : '';
    if (!type || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ type, id, label: typeof obj.label === 'string' ? obj.label : undefined });
  }
  if (parsed.length === 0) return [];

  const transcriptIds = parsed.filter((m) => m.type === 'transcript').map((m) => m.id);
  const noteIds = parsed.filter((m) => m.type === 'note').map((m) => m.id);
  const [transcripts, notes] = await Promise.all([
    transcriptIds.length
      ? db.transcript.findMany({
          where: { userId: uid, status: { not: 'TRASH' }, id: { in: transcriptIds } },
          select: {
            id: true,
            title: true,
            source: true,
            channel: true,
            summaryMd: true,
            plainText: true,
          },
        })
      : Promise.resolve([]),
    noteIds.length
      ? db.note.findMany({
          where: { userId: uid, kind: 'NOTE', id: { in: noteIds } },
          select: { id: true, title: true, content: true },
        })
      : Promise.resolve([]),
  ]);
  const transcriptMap = new Map(transcripts.map((t) => [t.id, t]));
  const noteMap = new Map(notes.map((n) => [n.id, n]));

  const contexts: LibraryMentionContext[] = [];
  for (const mention of parsed) {
    if (mention.type === 'transcript') {
      const t = transcriptMap.get(mention.id);
      if (!t) continue;
      contexts.push({
        type: 'transcript',
        id: t.id,
        label: t.title,
        subtitle: [t.source, t.channel].filter(Boolean).join(' · '),
        content: truncateMentionContent(t.summaryMd || t.plainText),
      });
    } else {
      const n = noteMap.get(mention.id);
      if (!n) continue;
      contexts.push({
        type: 'note',
        id: n.id,
        label: n.title,
        subtitle: 'Nota',
        content: truncateMentionContent(n.content),
      });
    }
  }
  return contexts;
}

function truncateMentionContent(text: string): string {
  const clean = text.trim();
  if (clean.length <= MAX_LIBRARY_MENTION_CHARS) return clean;
  return `${clean.slice(0, MAX_LIBRARY_MENTION_CHARS).trim()}\n\n[conteúdo truncado]`;
}

// ----------------------------------------------------------------------------
// Tools persistidas em ChatMessage.tools (ver .specs/026)
// ----------------------------------------------------------------------------

type ToolArgValue = string | number | boolean | null;

// `type` (não interface) — interfaces não têm index signature implícita e
// não são aceitas pelo InputJsonValue do Prisma.
type PersistedTool = {
  name: string;
  args?: Record<string, ToolArgValue>;
  preview?: string;
  summary?: string;
  sources?: Array<{ url: string; title: string }>;
};

const TOOL_ARGS_MAX_ENTRIES = 8;
const TOOL_ARGS_MAX_VALUE_CHARS = 300;
const TOOL_SOURCES_MAX = 20;
const TOOL_SOURCE_TITLE_MAX_CHARS = 300;
const TOOL_SOURCE_URL_MAX_CHARS = 2000;

// Só escalares truncados — args persistidos servem pra UI resumir a chamada
// (ex: query da pesquisa), não pra reproduzir o payload inteiro.
function sanitizeToolArgs(raw: unknown): Record<string, ToolArgValue> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, ToolArgValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= TOOL_ARGS_MAX_ENTRIES) break;
    if (typeof value === 'string') {
      out[key] =
        value.length > TOOL_ARGS_MAX_VALUE_CHARS
          ? `${value.slice(0, TOOL_ARGS_MAX_VALUE_CHARS)}…`
          : value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeToolSources(raw: unknown): Array<{ url: string; title: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ url: string; title: string }> = [];
  for (const item of raw) {
    if (out.length >= TOOL_SOURCES_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const url = String(record.url ?? '').trim();
    // Só http(s) — nunca renderizar javascript:/data: como link.
    if (!/^https?:\/\//i.test(url)) continue;
    const title = String(record.title ?? url)
      .trim()
      .slice(0, TOOL_SOURCE_TITLE_MAX_CHARS);
    out.push({ url: url.slice(0, TOOL_SOURCE_URL_MAX_CHARS), title });
  }
  return out.length > 0 ? out : undefined;
}

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

  // Cap pré-formData: Content-Length nem sempre é confiável (client pode mentir),
  // mas pega 99% e evita Bun carregar GBs em memória antes do file.size check.
  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > VOICE_MAX_BYTES) {
      return c.json(
        { error: `Áudio muito grande (${Math.round(declared / 1024 / 1024)} MB). Máximo: 25 MB.` },
        413,
      );
    }
  }

  const form = await c.req.formData();
  const file = form.get('audio');
  if (!(file instanceof File)) {
    return c.json({ error: 'Arquivo de áudio ausente.' }, 400);
  }

  // Content-Type allowlist estrito (anti-abuso: rejeita application/* etc).
  // Decisão: Content-Type vazio é REJEITADO — MediaRecorder sempre seta MIME
  // válido; sem MIME = caller artesanal/malicioso. Pra single-tenant é razoável.
  const declaredType = (file.type || '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (!declaredType || !VOICE_ALLOWED_MIMES.has(declaredType)) {
    return c.json(
      {
        error: declaredType
          ? `Tipo de áudio não permitido: ${declaredType}. Aceitos: webm, ogg, mp4, mpeg.`
          : 'Content-Type do áudio é obrigatório.',
      },
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
