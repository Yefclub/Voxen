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
  const transcripts = await db.transcript.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
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
    },
  });
  return c.json({ transcripts });
});

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (_s3) return _s3;
  const endpoint = process.env.GARAGE_ENDPOINT ?? 'http://garage:3900';
  const accessKey = process.env.GARAGE_ACCESS_KEY ?? readCredsFile('GARAGE_ACCESS_KEY');
  const secretKey = process.env.GARAGE_SECRET_KEY ?? readCredsFile('GARAGE_SECRET_KEY');
  if (!accessKey || !secretKey) {
    throw new Error('Garage credentials ausentes — checar /creds/voxen.env ou env');
  }
  _s3 = new S3Client({
    endpoint,
    region: process.env.GARAGE_REGION ?? 'garage',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  return _s3;
}

function readCredsFile(key: string): string | undefined {
  try {
    const path = process.env.GARAGE_CREDS_PATH ?? '/creds/voxen.env';
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
        Bucket: process.env.GARAGE_BUCKET ?? 'voxen-transcripts',
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
