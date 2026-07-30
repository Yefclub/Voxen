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
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { Prisma } from '../../prisma-generated/client';
import { auth } from '../lib/auth';
import { deleteBrainForSource, reindexNoteBrain, reindexTranscriptBrain } from '../lib/brain';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';
import { rateLimit } from '../lib/rate-limit';
import { deleteS3Object, s3Bucket, s3Client } from '../lib/s3';
import { isSetupComplete } from '../lib/settings';
import { generateTagsForContent, slugifyTag } from '../lib/tags-generate';
import { applyTagsToTranscript, type AppliedTag } from '../lib/tags';
import {
  generateAndPersistTranscriptSummary,
  TranscriptSummaryError,
} from '../lib/transcript-summary';

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
  originalObjectKey: string | null;
  originalFilename: string | null;
  originalMimeType: string | null;
  previewObjectKey: string | null;
  previewMimeType: string | null;
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

type TranscriptListFilters = {
  userId: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'ALL';
  folderId: string | null | undefined;
  tagId: string | undefined;
  from: Date | undefined;
  to: Date | undefined;
};

function organizationWhere(
  userId: string,
  folderId: TranscriptListFilters['folderId'],
): Prisma.TranscriptWhereInput {
  if (folderId === undefined) return {};
  if (folderId === null) {
    return {
      folderId: null,
      tags: { none: { tag: { userId, folderId: { not: null } } } },
    };
  }
  return {
    OR: [{ folderId }, { tags: { some: { tag: { userId, folderId } } } }],
  };
}

function buildTranscriptListWhere(filters: TranscriptListFilters): Prisma.TranscriptWhereInput {
  const conditions: Prisma.TranscriptWhereInput[] = [{ userId: filters.userId }];
  if (filters.status !== 'ALL') conditions.push({ status: filters.status });
  const organization = organizationWhere(filters.userId, filters.folderId);
  if (Object.keys(organization).length > 0) conditions.push(organization);
  if (filters.tagId) {
    conditions.push({ tags: { some: { tagId: filters.tagId, tag: { userId: filters.userId } } } });
  }
  if (filters.from || filters.to) {
    conditions.push({
      createdAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lt: filters.to } : {}),
      },
    });
  }
  return { AND: conditions };
}

function buildTranscriptListSqlExtra(filters: TranscriptListFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (filters.tagId) {
    conditions.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "TranscriptTag" selected_tag
        JOIN "Tag" tag ON tag.id = selected_tag."tagId"
        WHERE selected_tag."transcriptId" = t.id
          AND selected_tag."tagId" = ${filters.tagId}
          AND tag."userId" = ${filters.userId}
      )
    `);
  }
  if (filters.from) conditions.push(Prisma.sql`t."createdAt" >= ${filters.from}`);
  if (filters.to) conditions.push(Prisma.sql`t."createdAt" < ${filters.to}`);
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}`;
}

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
  const inbox = c.req.query('view') === 'inbox';
  const folderId = inbox ? null : normalizeFolderId(c.req.query('folderId'));
  const tagId = normalizeTagId(c.req.query('tagId'));
  const from = parseCreatedAtBound(c.req.query('from'));
  const to = parseCreatedAtBound(c.req.query('to'));
  const limit = parseListLimit(c.req.query('limit'));
  const offset = parseListOffset(c.req.query('offset'));
  const filters: TranscriptListFilters = { userId, status, folderId, tagId, from, to };
  const where = buildTranscriptListWhere(filters);
  const sqlExtra = buildTranscriptListSqlExtra(filters);

  if (query.length === 0) {
    const [transcripts, total] = await Promise.all([
      db.transcript.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        select: TRANSCRIPT_LIST_SELECT,
      }),
      db.transcript.count({ where }),
    ]);
    return c.json({
      transcripts: await withTags(userId, transcripts),
      query: '',
      total,
      limit,
      offset,
      hasMore: offset + transcripts.length < total,
    });
  }

  // Busca FTS em portuguese — o trigger SQL mantém o tsvector "searchVector"
  // sincronizado com `plainText`. ts_rank ordena por relevância.
  // Usamos plainto_tsquery (sanitiza input, não exige operadores).
  // Além do FTS, casamos por nome/slug de tag do conteúdo (spec 075, R6).
  const tagLike = `%${query}%`;
  const tagSlugLike = `%${slugifyTag(query)}%`;
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
      t."originalObjectKey",
      t."originalFilename",
      t."originalMimeType",
      t."previewObjectKey",
      t."previewMimeType",
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
      AND (
        ${folderId === undefined}
        OR (${folderId === null} AND t."folderId" IS NULL AND NOT EXISTS (
          SELECT 1 FROM "TranscriptTag" ft
          JOIN "Tag" ftag ON ftag.id = ft."tagId"
          WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
            AND ftag."folderId" IS NOT NULL
        ))
        OR (${typeof folderId === 'string'} AND (
          t."folderId" = ${folderId ?? ''}
          OR EXISTS (
            SELECT 1 FROM "TranscriptTag" ft
            JOIN "Tag" ftag ON ftag.id = ft."tagId"
            WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
              AND ftag."folderId" = ${folderId ?? ''}
          )
        ))
      )
      ${sqlExtra}
      AND (
        t."searchVector" @@ plainto_tsquery('portuguese', ${query})
        OR EXISTS (
          SELECT 1 FROM "TranscriptTag" tt
          JOIN "Tag" tg ON tg.id = tt."tagId"
          WHERE tt."transcriptId" = t.id
            AND tg."userId" = ${userId}
            AND (tg.name ILIKE ${tagLike} OR tg.slug ILIKE ${tagSlugLike})
        )
      )
    ORDER BY rank DESC, t."createdAt" DESC, t.id DESC
    LIMIT ${limit} OFFSET ${offset}
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
      t."originalObjectKey",
      t."originalFilename",
      t."originalMimeType",
      t."previewObjectKey",
      t."previewMimeType",
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
      AND (
        ${folderId === undefined}
        OR (${folderId === null} AND t."folderId" IS NULL AND NOT EXISTS (
          SELECT 1 FROM "TranscriptTag" ft JOIN "Tag" ftag ON ftag.id = ft."tagId"
          WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
            AND ftag."folderId" IS NOT NULL
        ))
        OR (${typeof folderId === 'string'} AND (
          t."folderId" = ${folderId ?? ''}
          OR EXISTS (
            SELECT 1 FROM "TranscriptTag" ft JOIN "Tag" ftag ON ftag.id = ft."tagId"
            WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
              AND ftag."folderId" = ${folderId ?? ''}
          )
        ))
      )
      ${sqlExtra}
      AND (
        t."searchVector" @@ plainto_tsquery('portuguese', ${query})
        OR EXISTS (
          SELECT 1 FROM "TranscriptTag" tt
          JOIN "Tag" tg ON tg.id = tt."tagId"
          WHERE tt."transcriptId" = t.id
            AND tg."userId" = ${userId}
            AND (tg.name ILIKE ${tagLike} OR tg.slug ILIKE ${tagSlugLike})
        )
      )
    ORDER BY rank DESC, t."createdAt" DESC, t.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const totalRows =
    status === 'ALL'
      ? await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Transcript" t
    WHERE t."userId" = ${userId}
      AND (
        ${folderId === undefined}
        OR (${folderId === null} AND t."folderId" IS NULL AND NOT EXISTS (
          SELECT 1 FROM "TranscriptTag" ft JOIN "Tag" ftag ON ftag.id = ft."tagId"
          WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
            AND ftag."folderId" IS NOT NULL
        ))
        OR (${typeof folderId === 'string'} AND (
          t."folderId" = ${folderId ?? ''}
          OR EXISTS (
            SELECT 1 FROM "TranscriptTag" ft JOIN "Tag" ftag ON ftag.id = ft."tagId"
            WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
              AND ftag."folderId" = ${folderId ?? ''}
          )
        ))
      )
      ${sqlExtra}
      AND (
        t."searchVector" @@ plainto_tsquery('portuguese', ${query})
        OR EXISTS (
          SELECT 1 FROM "TranscriptTag" tt
          JOIN "Tag" tg ON tg.id = tt."tagId"
          WHERE tt."transcriptId" = t.id
            AND tg."userId" = ${userId}
            AND (tg.name ILIKE ${tagLike} OR tg.slug ILIKE ${tagSlugLike})
        )
      )
  `
      : await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Transcript" t
    WHERE t."userId" = ${userId}
      AND t.status = ${status}::"ContentStatus"
      AND (
        ${folderId === undefined}
        OR (${folderId === null} AND t."folderId" IS NULL AND NOT EXISTS (
          SELECT 1 FROM "TranscriptTag" ft JOIN "Tag" ftag ON ftag.id = ft."tagId"
          WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
            AND ftag."folderId" IS NOT NULL
        ))
        OR (${typeof folderId === 'string'} AND (
          t."folderId" = ${folderId ?? ''}
          OR EXISTS (
            SELECT 1 FROM "TranscriptTag" ft JOIN "Tag" ftag ON ftag.id = ft."tagId"
            WHERE ft."transcriptId" = t.id AND ftag."userId" = ${userId}
              AND ftag."folderId" = ${folderId ?? ''}
          )
        ))
      )
      ${sqlExtra}
      AND (
        t."searchVector" @@ plainto_tsquery('portuguese', ${query})
        OR EXISTS (
          SELECT 1 FROM "TranscriptTag" tt
          JOIN "Tag" tg ON tg.id = tt."tagId"
          WHERE tt."transcriptId" = t.id
            AND tg."userId" = ${userId}
            AND (tg.name ILIKE ${tagLike} OR tg.slug ILIKE ${tagSlugLike})
        )
      )
  `;
  const total = Number(totalRows[0]?.count ?? 0);
  const transcripts = await withTags(userId, rows.map(mapSearchRow));
  return c.json({
    transcripts,
    query,
    total,
    limit,
    offset,
    hasMore: offset + transcripts.length < total,
  });
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
  originalObjectKey: true,
  originalFilename: true,
  originalMimeType: true,
  previewObjectKey: true,
  previewMimeType: true,
  costUsd: true,
  folderId: true,
  folder: { select: { id: true, name: true, parentId: true } },
  status: true,
  archivedAt: true,
  trashedAt: true,
  createdAt: true,
} as const;

// Carrega as tags (id/name/slug) de um conjunto de transcripts, escopadas por
// userId, e devolve um mapa transcriptId -> tags (ordenadas por nome).
async function loadTagsForTranscripts(
  userId: string,
  transcriptIds: string[],
): Promise<Map<string, AppliedTag[]>> {
  const map = new Map<string, AppliedTag[]>();
  if (transcriptIds.length === 0) return map;
  const links = await db.transcriptTag.findMany({
    where: { transcriptId: { in: transcriptIds }, tag: { userId } },
    select: {
      transcriptId: true,
      tag: { select: { id: true, name: true, slug: true } },
    },
  });
  for (const link of links) {
    const list = map.get(link.transcriptId) ?? [];
    list.push(link.tag);
    map.set(link.transcriptId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  return map;
}

// Anexa `tags` a cada item de uma lista de transcripts (in-place funcional).
async function withTags<T extends { id: string }>(
  userId: string,
  items: T[],
): Promise<(T & { tags: AppliedTag[] })[]> {
  const map = await loadTagsForTranscripts(
    userId,
    items.map((i) => i.id),
  );
  return items.map((i) => ({ ...i, tags: map.get(i.id) ?? [] }));
}

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
      originalObjectKey: true,
      originalFilename: true,
      originalMimeType: true,
      previewObjectKey: true,
      previewMimeType: true,
      language: true,
      transcriptionMethod: true,
      model: true,
      costUsd: true,
      mdPath: true,
      plainText: true,
      summaryMd: true,
      taggingStatus: true,
      taggingAttempts: true,
      taggingNextAttemptAt: true,
      taggingError: true,
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
  // {transcript_id}; STT remoto pode não vir com cost confiável da OR, mas o Decimal
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

  const tags = (await loadTagsForTranscripts(userId, [transcript.id])).get(transcript.id) ?? [];
  return c.json({ transcript: { ...transcript, totalCostUsd, tags }, markdown });
});

transcriptsRoutes.get('/:id/original', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id, userId },
    select: {
      id: true,
      originalObjectKey: true,
      originalFilename: true,
      originalMimeType: true,
    },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);
  if (!transcript.originalObjectKey)
    return c.json({ error: 'Arquivo original não disponível.' }, 404);
  // Range: o player de vídeo/áudio (e o Safari/iOS obrigatoriamente) precisa de
  // 206 + Accept-Ranges pra fazer seek. Repassamos o header pro S3/MinIO, que
  // fatia os bytes, e relayamos Content-Range/Content-Length da resposta dele.
  // Só single-range: multi-range (vírgula) viraria multipart/byteranges, que não
  // sabemos relayar — nesse caso servimos o arquivo inteiro (200).
  const rawRange = c.req.header('range');
  const rangeHeader = rawRange && !rawRange.includes(',') ? rawRange : undefined;
  try {
    const res = await s3Client().send(
      new GetObjectCommand({
        Bucket: s3Bucket(),
        Key: transcript.originalObjectKey,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      }),
    );
    const filename = safeDownloadFilename(transcript.originalFilename || `${id}.bin`);
    const init = buildOriginalResponseInit({
      rangeHeader,
      s3ContentType: res.ContentType,
      s3ContentLength: res.ContentLength,
      s3ContentRange: res.ContentRange,
      fallbackMime: transcript.originalMimeType,
      filename,
    });
    return new Response(await s3BodyToResponseBody(res.Body), init);
  } catch (err) {
    const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    if (httpStatus === 416) {
      return c.json({ error: 'Range solicitado inválido.' }, 416);
    }
    console.error('[transcripts] erro ao baixar original:', err);
    return c.json({ error: 'Falha ao baixar arquivo original.' }, 502);
  }
});

transcriptsRoutes.get('/:id/preview', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  let transcript = await db.transcript.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      source: true,
      url: true,
      thumbnailUrl: true,
      previewObjectKey: true,
      previewMimeType: true,
      originalObjectKey: true,
      originalMimeType: true,
    },
  });
  if (!transcript) return c.text('', 404);

  // Lazy-mirror: se ainda só temos URL remota (legado TikTok/IG), tenta
  // baixar e gravar no S3 uma vez. Se a CDN já 403, cai no SVG.
  if (!transcript.previewObjectKey && isHttpUrl(transcript.thumbnailUrl)) {
    const mirrored = await tryMirrorRemoteThumbnail({
      userId,
      transcriptId: id,
      remoteUrl: transcript.thumbnailUrl!,
      referer: transcript.url,
    });
    if (mirrored) {
      transcript = {
        ...transcript,
        previewObjectKey: mirrored.key,
        previewMimeType: mirrored.mime,
        thumbnailUrl: `/api/transcripts/${id}/preview`,
      };
    }
  }

  // Só servimos a imagem original como preview se for raster segura
  // (png/jpeg/webp/gif). image/svg+xml é executável em navegação direta à URL →
  // cai no placeholder. A preview gerada (previewObjectKey) é sempre JPEG nosso.
  const originalIsSafeImage =
    !!transcript.originalObjectKey &&
    !!transcript.originalMimeType &&
    transcript.originalMimeType.startsWith('image/') &&
    inlineSafeMime(transcript.originalMimeType);
  const objectKey =
    transcript.previewObjectKey || (originalIsSafeImage ? transcript.originalObjectKey : null);
  const mimeType =
    transcript.previewObjectKey && transcript.previewMimeType
      ? transcript.previewMimeType
      : originalIsSafeImage
        ? transcript.originalMimeType
        : null;
  if (objectKey && mimeType) {
    try {
      const res = await s3Client().send(
        new GetObjectCommand({
          Bucket: s3Bucket(),
          Key: objectKey,
        }),
      );
      return new Response(await s3BodyToResponseBody(res.Body), {
        headers: {
          'content-type': mimeType,
          'cache-control': 'private, max-age=300',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (err) {
      console.error('[transcripts] erro ao baixar preview:', err);
    }
  }
  return new Response(renderPreviewSvg(transcript.title, transcript.source), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
});

/** POST /:id/refresh-thumbnail — tenta espelhar de novo a capa (URL remota ou re-probe leve). */
transcriptsRoutes.post('/:id/refresh-thumbnail', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const transcript = await db.transcript.findFirst({
    where: { id, userId, status: { not: 'TRASH' } },
    select: {
      id: true,
      url: true,
      thumbnailUrl: true,
      previewObjectKey: true,
    },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const remote =
    isHttpUrl(transcript.thumbnailUrl) && transcript.thumbnailUrl ? transcript.thumbnailUrl : null;
  if (!remote) {
    // Já está no path interno / sem URL remota: limpa broken e usa placeholder.
    await db.transcript.update({
      where: { id },
      data: {
        thumbnailUrl: `/api/transcripts/${id}/preview`,
      },
    });
    return c.json({
      ok: true,
      mirrored: false,
      thumbnailUrl: `/api/transcripts/${id}/preview`,
      hint: 'Sem URL remota para rebaixar; capa usa placeholder interno.',
    });
  }

  const mirrored = await tryMirrorRemoteThumbnail({
    userId,
    transcriptId: id,
    remoteUrl: remote,
    referer: transcript.url,
  });
  if (!mirrored) {
    await db.transcript.update({
      where: { id },
      data: { thumbnailUrl: `/api/transcripts/${id}/preview` },
    });
    return c.json(
      {
        ok: false,
        mirrored: false,
        thumbnailUrl: `/api/transcripts/${id}/preview`,
        error:
          'Não foi possível baixar a capa remota (URL expirada ou bloqueada). Usando placeholder.',
      },
      422,
    );
  }
  return c.json({
    ok: true,
    mirrored: true,
    thumbnailUrl: `/api/transcripts/${id}/preview`,
    previewObjectKey: mirrored.key,
  });
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

// POST /api/transcripts/:id/generate-tags — gera tags via IA para UM conteúdo
// (spec 075). Re-gera e faz merge (dedup por slug); nunca duplica. Throttle
// 1/min por transcript pra não queimar tokens em cliques repetidos.
transcriptsRoutes.post('/:id/generate-tags', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  if (!(await isSetupComplete())) {
    return c.json({ error: 'Setup incompleto.' }, 412);
  }

  const rl = await rateLimit(`voxen:rl:tags:${id}`, 1, 60);
  if (!rl.allowed) {
    return c.json(
      { error: `Aguarde ${rl.resetIn}s antes de gerar tags novamente.`, retryAfter: rl.resetIn },
      429,
    );
  }

  const transcript = await db.transcript.findFirst({
    where: { id, userId },
    select: { id: true, title: true, plainText: true, summaryMd: true, folderId: true },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);

  const content = ((transcript.summaryMd ?? '') || (transcript.plainText ?? '')).trim();
  if (content.length < 40 && transcript.title.trim().length < 3) {
    return c.json({ error: 'Conteúdo curto demais para gerar tags.' }, 422);
  }

  const existingTags = (
    await db.tag.findMany({ where: { userId }, select: { name: true }, orderBy: { name: 'asc' } })
  ).map((t) => t.name);

  let result: Awaited<ReturnType<typeof generateTagsForContent>>;
  try {
    result = await generateTagsForContent({
      title: transcript.title,
      content: content || transcript.title,
      existingTags,
    });
  } catch (err) {
    console.error('[transcripts] falha ao gerar tags', {
      error_type: err instanceof Error ? err.name : 'UnknownError',
    });
    return c.json({ error: 'Falha ao gerar tags. Tente novamente.' }, 502);
  }

  await db.costEvent.create({
    data: {
      userId,
      kind: 'CHAT',
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      meta: {
        source: 'tag_generation',
        transcript_id: transcript.id,
        generated_count: result.tags.length,
      },
    },
  });

  if (result.tags.length === 0) {
    return c.json({ tags: [] as AppliedTag[], generated: 0 });
  }

  const applied = await applyTagsToTranscript(
    userId,
    { id: transcript.id, folderId: transcript.folderId },
    result.tags,
  );
  // Devolve TODAS as tags do conteúdo (merge acumulado), não só as novas.
  const tags = (await loadTagsForTranscripts(userId, [transcript.id])).get(transcript.id) ?? [];
  return c.json({ tags, generated: applied.length });
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
    select: {
      id: true,
      status: true,
      mdPath: true,
      title: true,
      originalObjectKey: true,
      previewObjectKey: true,
    },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);
  if (transcript.status !== 'TRASH') {
    return c.json({ error: 'Mova para a lixeira antes de apagar definitivamente.' }, 409);
  }

  try {
    await Promise.all(
      [transcript.mdPath, transcript.previewObjectKey, transcript.originalObjectKey]
        .filter((key): key is string => Boolean(key))
        .map((key) => deleteS3Object(key)),
    );
  } catch (err) {
    console.error('[transcripts] erro ao apagar objetos no S3:', err);
    return c.json({ error: 'Falha ao apagar arquivos no armazenamento S3.' }, 502);
  }

  await db.transcript.delete({ where: { id } });
  await deleteBrainForSource(userId, 'TRANSCRIPT', id);
  await invalidateGraphCache(userId);
  return c.json({ ok: true, deletedId: id });
});

// POST /api/transcripts/:id/summary — gerar / regenerar resumo via OpenRouter.
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

  try {
    const summaryMd = await generateAndPersistTranscriptSummary({
      userId,
      transcriptId: transcript.id,
      title: transcript.title,
      plainText: transcript.plainText,
    });
    return c.json({ summaryMd });
  } catch (err) {
    if (err instanceof TranscriptSummaryError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    console.error('[transcripts] summary failed:', err);
    return c.json({ error: 'Falha ao gerar resumo.' }, 502);
  }
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

function normalizeTagId(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id && id.length <= 191 ? id : undefined;
}

function parseCreatedAtBound(value: string | undefined): Date | undefined {
  if (!value || value.length > 40) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 50;

function parseListLimit(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

function parseListOffset(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 10_000);
}

function mapSearchRow(row: SearchRow): SearchRow & { folder: { id: string; name: string } | null } {
  return {
    ...row,
    folder: row.folderId && row.folderName ? { id: row.folderId, name: row.folderName } : null,
  };
}

async function s3BodyToResponseBody(body: unknown): Promise<BodyInit> {
  const maybeBody = body as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    transformToByteArray?: () => Promise<Uint8Array>;
  } | null;
  if (maybeBody?.transformToWebStream) return maybeBody.transformToWebStream();
  if (maybeBody?.transformToByteArray) {
    const bytes = await maybeBody.transformToByteArray();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
  return new ArrayBuffer(0);
}

// Monta status + headers da resposta de `/:id/original`. Puro (sem I/O) para ser
// testável: decide 206 (Range satisfeito pelo S3) vs 200, e relaya os headers de
// range. `accept-ranges: bytes` sempre presente para o player saber que dá seek.
export function buildOriginalResponseInit(opts: {
  rangeHeader?: string;
  s3ContentType?: string;
  s3ContentLength?: number;
  s3ContentRange?: string;
  fallbackMime: string | null;
  filename: string;
}): { status: number; headers: Record<string, string> } {
  const contentType = opts.fallbackMime || opts.s3ContentType || 'application/octet-stream';
  // Conteúdo é upload do usuário (NÃO confiável): só mídia segura vai `inline` no
  // contexto same-origin da app; o resto (text/html, image/svg+xml, pdf...) vira
  // `attachment` (download), evitando XSS armazenado. `nosniff` impede o browser
  // de reinterpretar o MIME e executar como HTML.
  const headers: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'private, max-age=300',
    'content-disposition': `${inlineSafeMime(contentType) ? 'inline' : 'attachment'}; filename="${opts.filename}"`,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  };
  if (opts.s3ContentLength != null) headers['content-length'] = String(opts.s3ContentLength);
  if (opts.rangeHeader && opts.s3ContentRange) {
    headers['content-range'] = opts.s3ContentRange;
    return { status: 206, headers };
  }
  return { status: 200, headers };
}

// Tipos servidos `inline` (renderizados no browser same-origin). Restrito a mídia
// que o player usa; text/html, image/svg+xml e pdf ficam de fora (vão como
// attachment) porque podem executar script no contexto da aplicação.
function inlineSafeMime(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ct.startsWith('video/') || ct.startsWith('audio/')) return true;
  return ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/webp' || ct === 'image/gif';
}

function safeDownloadFilename(value: string): string {
  return value
    .replace(/[\\/\r\n"]/g, '_')
    .replace(/[^\w .()-]+/g, '_')
    .slice(0, 160);
}

function renderPreviewSvg(title: string, source: string): string {
  const cleanTitle = escapeXml(title).slice(0, 120);
  const cleanSource = escapeXml(sourceLabel(source));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="${cleanTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#202326"/>
      <stop offset="0.55" stop-color="#191b1d"/>
      <stop offset="1" stop-color="#17362f"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="22%" r="55%">
      <stop stop-color="#10b981" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#10b981" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <rect x="72" y="72" width="1136" height="576" rx="44" fill="#ffffff" fill-opacity="0.035" stroke="#ffffff" stroke-opacity="0.12"/>
  <text x="112" y="160" fill="#9ca3af" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="8">${cleanSource}</text>
  <foreignObject x="112" y="230" width="960" height="250">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, Arial, sans-serif; color: #f8fafc; font-size: 62px; font-weight: 750; line-height: 1.08; overflow-wrap: anywhere;">${cleanTitle}</div>
  </foreignObject>
  <circle cx="1112" cy="560" r="58" fill="#10b981" fill-opacity="0.16" stroke="#34d399" stroke-opacity="0.5"/>
  <path d="M1095 535v50l44-25-44-25Z" fill="#6ee7b7"/>
</svg>`;
}

function sourceLabel(source: string): string {
  if (source === 'WEB') return 'PÁGINA WEB';
  if (source === 'UPLOAD') return 'UPLOAD';
  if (source === 'X') return 'X';
  return source;
}

function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

const THUMB_HOST_SUFFIXES = [
  'ytimg.com',
  'ggpht.com',
  'googleusercontent.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokv.com',
  'byteoversea.com',
  'ibyteimg.com',
  'cdninstagram.com',
  'fbcdn.net',
  'twimg.com',
];

function thumbHostAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return THUMB_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

function mimeFromContentType(ct: string | null, url: string): { ext: string; mime: string } {
  const base = (ct ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'image/jpeg' || base === 'image/jpg') return { ext: 'jpg', mime: 'image/jpeg' };
  if (base === 'image/png') return { ext: 'png', mime: 'image/png' };
  if (base === 'image/webp') return { ext: 'webp', mime: 'image/webp' };
  if (base === 'image/gif') return { ext: 'gif', mime: 'image/gif' };
  const path = url.toLowerCase();
  if (path.includes('.png')) return { ext: 'png', mime: 'image/png' };
  if (path.includes('.webp')) return { ext: 'webp', mime: 'image/webp' };
  return { ext: 'jpg', mime: 'image/jpeg' };
}

async function tryMirrorRemoteThumbnail(opts: {
  userId: string;
  transcriptId: string;
  remoteUrl: string;
  referer?: string | null;
}): Promise<{ key: string; mime: string } | null> {
  let host: string;
  try {
    host = new URL(opts.remoteUrl).hostname;
  } catch {
    return null;
  }
  if (!thumbHostAllowed(host)) return null;

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; VoxenBot/1.0; +https://github.com/Yefclub/Voxen)',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  if (opts.referer) headers.Referer = opts.referer;

  try {
    const res = await fetch(opts.remoteUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return null;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49;
    const isWebp = buf.length > 12 && buf.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isGif && !isWebp) return null;

    const { ext, mime } = mimeFromContentType(res.headers.get('content-type'), opts.remoteUrl);
    const key = `workspaces/${opts.userId}/transcripts/${opts.transcriptId}/thumbnail.${ext}`;
    await s3Client().send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: key,
        Body: buf,
        ContentType: mime,
      }),
    );
    await db.transcript.update({
      where: { id: opts.transcriptId },
      data: {
        previewObjectKey: key,
        previewMimeType: mime,
        thumbnailUrl: `/api/transcripts/${opts.transcriptId}/preview`,
      },
    });
    return { key, mime };
  } catch (err) {
    console.warn(
      '[transcripts] mirror thumbnail failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return ch;
    }
  });
}
