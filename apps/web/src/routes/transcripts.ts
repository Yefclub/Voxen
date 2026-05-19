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
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import { s3Bucket, s3Client } from '../lib/s3';

// Anti-loop de UI: 1 regeneração de summary por minuto por transcript.
const SUMMARY_MIN_INTERVAL_SEC = 60;

type Vars = { userId: string };

export const transcriptsRoutes = new Hono<{ Variables: Vars }>();

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

  if (query.length === 0) {
    const transcripts = await db.transcript.findMany({
      where: { userId },
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
  type Row = {
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
    createdAt: Date;
    snippet: string;
    rank: number;
  };
  const rows = await db.$queryRaw<Row[]>`
    SELECT
      id,
      source::text AS source,
      url,
      title,
      channel,
      "durationSec",
      language,
      "transcriptionMethod"::text AS "transcriptionMethod",
      "thumbnailUrl",
      "costUsd"::text AS "costUsd",
      "createdAt",
      ts_headline(
        'portuguese',
        "plainText",
        plainto_tsquery('portuguese', ${query}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1, FragmentDelimiter=" … "'
      ) AS snippet,
      ts_rank("searchVector", plainto_tsquery('portuguese', ${query})) AS rank
    FROM "Transcript"
    WHERE "userId" = ${userId}
      AND "searchVector" @@ plainto_tsquery('portuguese', ${query})
    ORDER BY rank DESC, "createdAt" DESC
    LIMIT 100
  `;
  return c.json({ transcripts: rows, query });
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
  createdAt: true,
} as const;

transcriptsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id, userId },
    select: {
      id: true,
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
    where: { id, userId },
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
