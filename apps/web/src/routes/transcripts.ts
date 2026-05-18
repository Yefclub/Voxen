// ============================================================================
// Voxen — Transcripts routes
// ============================================================================
// Endpoints (sempre escopados por userId):
//   GET  /api/transcripts          — lista (paginada)
//   GET  /api/transcripts/:id      — metadata + plainText + markdown content
//
// .md content é lido do Garage S3. Em prod, considerar cache; MVP busca direto.
// ============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';

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

// S3-compatible storage (Garage default; MinIO/AWS S3 também suportados).
// Aceita variáveis `S3_*` com fallback pra `GARAGE_*` p/ compat com setup atual.
let _s3: S3Client | null = null;
function envOr(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

function getS3(): S3Client {
  if (_s3) return _s3;
  const endpoint = envOr('S3_ENDPOINT', 'GARAGE_ENDPOINT') ?? 'http://garage:3900';
  const accessKey =
    envOr('S3_ACCESS_KEY', 'GARAGE_ACCESS_KEY') ??
    readCredsFile('S3_ACCESS_KEY') ??
    readCredsFile('GARAGE_ACCESS_KEY');
  const secretKey =
    envOr('S3_SECRET_KEY', 'GARAGE_SECRET_KEY') ??
    readCredsFile('S3_SECRET_KEY') ??
    readCredsFile('GARAGE_SECRET_KEY');
  if (!accessKey || !secretKey) {
    throw new Error(
      'Credenciais S3 ausentes — defina S3_ACCESS_KEY/S3_SECRET_KEY (ou GARAGE_*) ou /creds/voxen.env',
    );
  }
  const forcePathStyle = (envOr('S3_FORCE_PATH_STYLE') ?? 'true').toLowerCase() !== 'false';
  _s3 = new S3Client({
    endpoint,
    region: envOr('S3_REGION', 'GARAGE_REGION') ?? 'garage',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle,
  });
  return _s3;
}

function readCredsFile(key: string): string | undefined {
  try {
    const path = envOr('S3_CREDS_PATH', 'GARAGE_CREDS_PATH') ?? '/creds/voxen.env';
    if (!existsSync(path)) return undefined;
    const content = readFileSync(path, 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

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

  // Busca o .md no Garage
  let markdown = '';
  try {
    const s3 = getS3();
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: envOr('S3_BUCKET', 'GARAGE_BUCKET') ?? 'voxen-transcripts',
        Key: transcript.mdPath,
      }),
    );
    markdown = (await res.Body?.transformToString('utf-8')) ?? '';
  } catch (err) {
    console.error('[transcripts] erro ao baixar .md:', err);
    // Fallback: monta o markdown a partir do plainText (sem timestamps)
    markdown = `# ${transcript.title}\n\n${transcript.plainText}`;
  }

  return c.json({ transcript, markdown });
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
