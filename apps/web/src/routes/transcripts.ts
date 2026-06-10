// ============================================================================
// Voxen — Transcripts routes
// ============================================================================
// Endpoints (sempre escopados por userId):
//   GET  /api/transcripts          — lista (paginada)
//   GET  /api/transcripts/:id      — metadata + plainText + markdown content
//
// .md content é lido do storage S3. Em prod, considerar cache; MVP busca direto.
// ============================================================================

import { Hono } from 'hono';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { deleteBrainForSource, reindexNoteBrain, reindexTranscriptBrain } from '../lib/brain';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';
import { rateLimit } from '../lib/rate-limit';
import { deleteS3Object, s3Bucket, s3Client } from '../lib/s3';

// Anti-loop de UI: 1 regeneração de summary por minuto por transcript.
const SUMMARY_MIN_INTERVAL_SEC = 60;

type Vars = { userId: string };

export const transcriptsRoutes = new Hono<{ Variables: Vars }>();

type SearchRow = {
  id: string;
  source: string;
  url: string;
  title: string;
  channel: string | null;
  durationSec: number;
  language: string;
  transcriptionMethod: string;
  thumbnailUrl: string | null;
  costUsd: string | null;
  folderId: string | null;
  folderName: string | null;
  status: string;
  archivedAt: Date | null;
  trashedAt: Date | null;
  createdAt: Date;
  snippet: string;
  rank: number;
};

transcriptsRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  c.set('userId', session.user.id);
  return next();
});

transcriptsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const query = (c.req.query('q') ?? '').trim();
  const status = normalizeStatus(c.req.query('status'));
  const folderId = normalizeFolderId(c.req.query('folderId'));
  const where = {
    userId,
    ...(status === 'ALL' ? {} : { status }),
    ...(folderId !== undefined ? { folderId } : {}),
  };

  if (query.length === 0) {
    const transcripts = await db.transcript.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: TRANSCRIPT_LIST_SELECT,
    });
    return c.json({ transcripts, query: '' });
  }

  // Busca FTS em portuguese — o trigger SQL mantém o tsvector "searchVector"
  // sincronizado com `plainText`. ts_rank ordena por relevância.
  // Usamos plainto_tsquery (sanitiza input, não exige operadores) e
  // limitamos a 100 resultados.
  const rows =
    status === 'ALL'
      ? await db.$queryRaw<SearchRow[]>`
    SELECT
      t.id,
      t.source::text AS source,
      t.url,
      t.title,
      t.channel,
      t."durationSec",
      t.language,
      t."transcriptionMethod"::text AS "transcriptionMethod",
      t."thumbnailUrl",
      t."costUsd"::text AS "costUsd",
      t."folderId",
      f.name AS "folderName",
      t.status::text AS status,
      t."archivedAt",
      t."trashedAt",
      t."createdAt",
      ts_headline(
        'portuguese',
        t."plainText",
        plainto_tsquery('portuguese', ${query}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1, FragmentDelimiter=" … "'
      ) AS snippet,
      ts_rank(t."searchVector", plainto_tsquery('portuguese', ${query})) AS rank
    FROM "Transcript" t
    LEFT JOIN "LibraryFolder" f ON f.id = t."folderId" AND f."userId" = t."userId"
    WHERE t."userId" = ${userId}
      AND (${folderId === undefined} OR t."folderId" IS NOT DISTINCT FROM ${folderId ?? null})
      AND t."searchVector" @@ plainto_tsquery('portuguese', ${query})
    ORDER BY rank DESC, t."createdAt" DESC
    LIMIT 100
  `
      : await db.$queryRaw<SearchRow[]>`
    SELECT
      t.id,
      t.source::text AS source,
      t.url,
      t.title,
      t.channel,
      t."durationSec",
      t.language,
      t."transcriptionMethod"::text AS "transcriptionMethod",
      t."thumbnailUrl",
      t."costUsd"::text AS "costUsd",
      t."folderId",
      f.name AS "folderName",
      t.status::text AS status,
      t."archivedAt",
      t."trashedAt",
      t."createdAt",
      ts_headline(
        'portuguese',
        t."plainText",
        plainto_tsquery('portuguese', ${query}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1, FragmentDelimiter=" … "'
      ) AS snippet,
      ts_rank(t."searchVector", plainto_tsquery('portuguese', ${query})) AS rank
    FROM "Transcript" t
    LEFT JOIN "LibraryFolder" f ON f.id = t."folderId" AND f."userId" = t."userId"
    WHERE t."userId" = ${userId}
      AND t.status = ${status}::"ContentStatus"
      AND (${folderId === undefined} OR t."folderId" IS NOT DISTINCT FROM ${folderId ?? null})
      AND t."searchVector" @@ plainto_tsquery('portuguese', ${query})
    ORDER BY rank DESC, t."createdAt" DESC
    LIMIT 100
  `;
  return c.json({ transcripts: rows.map(mapSearchRow), query });
});

const TRANSCRIPT_LIST_SELECT = {
  id: true,
  source: true,
  url: true,
  title: true,
  channel: true,
  durationSec: true,
  language: true,
  transcriptionMethod: true,
  thumbnailUrl: true,
  costUsd: true,
  folderId: true,
  folder: { select: { id: true, name: true, parentId: true } },
  status: true,
  archivedAt: true,
  trashedAt: true,
  createdAt: true,
} as const;

transcriptsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const includeTrash = c.req.query('includeTrash') === '1';
  const transcript = await db.transcript.findFirst({
    where: { id, userId, ...(includeTrash ? {} : { status: { not: 'TRASH' as const } }) },
    select: {
      id: true,
      folderId: true,
      folder: { select: { id: true, name: true, parentId: true } },
      status: true,
      source: true,
      url: true,
      title: true,
      channel: true,
      author: true,
      durationSec: true,
      publishedAt: true,
      thumbnailUrl: true,
      language: true,
      transcriptionMethod: true,
      model: true,
      costUsd: true,
      mdPath: true,
      plainText: true,
      summaryMd: true,
      frontmatter: true,
      archivedAt: true,
      trashedAt: true,
      createdAt: true,
    },
  });
  if (!transcript) {
    return c.json({ error: 'Transcrição não encontrada.' }, 404);
  }

  // Soma custos relacionados (summary é registrado em CostEvent.meta com
  // {transcript_id}; Whisper não vem com cost confiável do OR mas o Decimal
  // do Transcript pode conter). totalCostUsd reflete o custo *real* do user.
  const summaryCosts = await db.$queryRaw<{ total: string | null }[]>`
    SELECT COALESCE(SUM("costUsd"), 0)::text AS total
    FROM "CostEvent"
    WHERE "userId" = ${userId}
      AND meta->>'transcript_id' = ${transcript.id}
  `;
  const summarySum = parseFloat(summaryCosts[0]?.total ?? '0');
  const baseCost = transcript.costUsd ? parseFloat(transcript.costUsd.toString()) : 0;
  const totalCostUsd = (baseCost + summarySum).toFixed(6);

  // Busca o .md no S3 com fallback pro plainText em caso de erro
  const markdown = await (async (): Promise<string> => {
    try {
      const res = await s3Client().send(
        new GetObjectCommand({
          Bucket: s3Bucket(),
          Key: transcript.mdPath,
        }),
      );
      return (await res.Body?.transformToString('utf-8')) ?? '';
    } catch (err) {
      console.error('[transcripts] erro ao baixar .md:', err);
      return `# ${transcript.title}\n\n${transcript.plainText}`;
    }
  })();

  return c.json({ transcript: { ...transcript, totalCostUsd }, markdown });
});

const LinkedNoteBody = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(200_000).default(''),
});

transcriptsRoutes.get('/:id/notes', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id, userId, status: { not: 'TRASH' } },
    select: { id: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const notes = await db.note.findMany({
    where: {
      userId,
      kind: 'NOTE',
      sourceType: 'TRANSCRIPT',
      sourceId: id,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      updatedAt: true,
      createdAt: true,
    },
    take: 20,
  });
  return c.json({ notes });
});

transcriptsRoutes.post('/:id/notes', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = LinkedNoteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);

  const transcript = await db.transcript.findFirst({
    where: { id, userId, status: { not: 'TRASH' } },
    select: { id: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const note = await db.note.create({
    data: {
      userId,
      kind: 'NOTE',
      title: parsed.data.title.trim(),
      content: parsed.data.content,
      sourceType: 'TRANSCRIPT',
      sourceId: id,
    },
    select: {
      id: true,
      title: true,
      content: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  await reindexNoteBrain(userId, note.id);
  await invalidateGraphCache(userId);
  return c.json({ note }, 201);
});

const OrganizationBody = z.object({
  folderId: z.string().nullable(),
});

transcriptsRoutes.patch('/:id/organization', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = OrganizationBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { folderId } = parsed.data;

  const existing = await db.transcript.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  if (folderId) {
    const folder = await db.libraryFolder.findFirst({
      where: { id: folderId, userId },
      select: { id: true },
    });
    if (!folder) return c.json({ error: 'Pasta não encontrada.' }, 400);
  }

  const transcript = await db.transcript.update({
    where: { id },
    data: { folderId },
    select: TRANSCRIPT_LIST_SELECT,
  });
  await reindexTranscriptBrain(userId, id);
  await invalidateGraphCache(userId);
  return c.json({ transcript });
});

const LifecycleBody = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'TRASH']),
});

transcriptsRoutes.patch('/:id/lifecycle', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = LifecycleBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { status } = parsed.data;

  const existing = await db.transcript.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const now = new Date();
  const transcript = await db.transcript.update({
    where: { id },
    data: {
      status,
      archivedAt: status === 'ARCHIVED' ? now : null,
      trashedAt: status === 'TRASH' ? now : null,
    },
    select: TRANSCRIPT_LIST_SELECT,
  });
  await reindexTranscriptBrain(userId, id);
  await invalidateGraphCache(userId);
  return c.json({ transcript });
});

// DELETE /api/transcripts/:id — purge definitivo.
// Por segurança, exige que a transcrição esteja na lixeira antes do hard delete.
transcriptsRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id, userId },
    select: { id: true, status: true, mdPath: true, title: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);
  if (transcript.status !== 'TRASH') {
    return c.json({ error: 'Mova para a lixeira antes de apagar definitivamente.' }, 409);
  }

  try {
    await deleteS3Object(transcript.mdPath);
  } catch (err) {
    console.error('[transcripts] erro ao apagar .md do S3:', err);
    return c.json({ error: 'Falha ao apagar arquivo no armazenamento S3.' }, 502);
  }

  await db.transcript.delete({ where: { id } });
  await deleteBrainForSource(userId, 'TRANSCRIPT', id);
  await invalidateGraphCache(userId);
  return c.json({ ok: true, deletedId: id });
});

// POST /api/transcripts/:id/summary — gerar / regenerar resumo via chat service.
// Anti-abuso: throttle 1/min por transcript + se já tem summary, exige
// { force: true } pra não queimar tokens da OR num clique acidental.
transcriptsRoutes.post('/:id/summary', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  // Throttle ANTES do DB — clique repetido (loop UI) bloqueia em Redis sem
  // tocar Postgres. SELECT é cheap mas em volume isso multiplica.
  const rl = await rateLimit(`voxen:rl:summary:${id}`, 1, SUMMARY_MIN_INTERVAL_SEC);
  if (!rl.allowed) {
    return c.json(
      {
        error: `Aguarde ${rl.resetIn}s antes de regenerar este resumo.`,
        retryAfter: rl.resetIn,
      },
      429,
    );
  }

  const transcript = await db.transcript.findFirst({
    where: { id, userId, status: { not: 'TRASH' } },
    select: { id: true, title: true, plainText: true, summaryMd: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);
  if (!transcript.plainText?.trim()) {
    return c.json({ error: 'Transcrição sem texto para resumir.' }, 422);
  }

  // Já tem resumo → exige force=true (confirmação explícita do user)
  if (transcript.summaryMd && !force) {
    return c.json(
      {
        error: 'Resumo já existe. Use { "force": true } pra regenerar.',
        existing: true,
      },
      409,
    );
  }

  const upstreamUrl =
    (process.env.CHAT_SERVICE_URL ?? 'http://chat:8001') + '/summarize-transcript';
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Voxen-User-Id': userId,
    },
    body: JSON.stringify({
      transcript_id: transcript.id,
      title: transcript.title,
      plain_text: transcript.plainText,
    }),
  });
  const data = (await upstream.json().catch(() => ({}))) as {
    summary_md?: string;
    detail?: string;
  };
  if (!upstream.ok) {
    return c.json({ error: data.detail ?? 'Falha ao gerar resumo.' }, upstream.status as 200);
  }
  return c.json({ summaryMd: data.summary_md ?? null });
});

function normalizeStatus(value: string | undefined): 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'ALL' {
  if (value === 'archived') return 'ARCHIVED';
  if (value === 'trash') return 'TRASH';
  if (value === 'all') return 'ALL';
  return 'ACTIVE';
}

function normalizeFolderId(value: string | undefined): string | null | undefined {
  if (!value) return undefined;
  if (value === 'none') return null;
  return value;
}

function mapSearchRow(row: SearchRow): SearchRow & { folder: { id: string; name: string } | null } {
  return {
    ...row,
    folder: row.folderId && row.folderName ? { id: row.folderId, name: row.folderName } : null,
  };
}
