import { Hono } from 'hono';
import { Prisma } from '../../prisma-generated/client';
import { db } from '../lib/db';

type Vars = { userId: string };

const DEFAULT_TAG_LIST_LIMIT = 6;
const MAX_TAG_LIST_LIMIT = 50;

function parseTagListLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TAG_LIST_LIMIT;
  return Math.min(parsed, MAX_TAG_LIST_LIMIT);
}

function parseTagListOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 10_000);
}

function normalizeTagQuery(value: string | undefined): string | undefined {
  const query = value?.trim().slice(0, 120);
  return query || undefined;
}

function normalizeTagStatus(value: string | undefined): 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'ALL' {
  if (value === 'archived') return 'ARCHIVED';
  if (value === 'trash') return 'TRASH';
  if (value === 'all') return 'ALL';
  return 'ACTIVE';
}

export const libraryTagRoutes = new Hono<{ Variables: Vars }>();

// The catalog follows the active library lifecycle filter and stays scoped to the current owner.
libraryTagRoutes.get('/tags', async (c) => {
  const userId = c.get('userId');
  const limit = parseTagListLimit(c.req.query('limit'));
  const offset = parseTagListOffset(c.req.query('offset'));
  const query = normalizeTagQuery(c.req.query('q'));
  const selectedId = c.req.query('selectedId')?.trim().slice(0, 191) || undefined;
  const status = normalizeTagStatus(c.req.query('status'));
  const searchClause = query ? Prisma.sql`AND tag.name ILIKE ${`%${query}%`}` : Prisma.empty;
  const statusClause =
    status === 'ALL' ? Prisma.empty : Prisma.sql`AND t.status = ${status}::"ContentStatus"`;
  const [tags, totals, selectedTag] = await Promise.all([
    db.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
      SELECT tag.id, tag.name, tag.slug, COUNT(tt."transcriptId")::bigint AS count
      FROM "Tag" tag
      JOIN "TranscriptTag" tt ON tt."tagId" = tag.id
      JOIN "Transcript" t ON t.id = tt."transcriptId"
      WHERE tag."userId" = ${userId}
        AND t."userId" = ${userId}
        ${statusClause}
        ${searchClause}
      GROUP BY tag.id, tag.name, tag.slug
      ORDER BY count DESC, tag.name ASC, tag.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT tag.id)::bigint AS count
      FROM "Tag" tag
      JOIN "TranscriptTag" tt ON tt."tagId" = tag.id
      JOIN "Transcript" t ON t.id = tt."transcriptId"
      WHERE tag."userId" = ${userId}
        AND t."userId" = ${userId}
        ${statusClause}
        ${searchClause}
    `,
    selectedId
      ? db.tag.findFirst({
          where: { id: selectedId, userId },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve(null),
  ]);
  const total = Number(totals[0]?.count ?? 0);
  return c.json({
    tags: tags.map((tag) => ({ ...tag, count: Number(tag.count) })),
    total,
    limit,
    offset,
    query: query ?? '',
    status,
    hasMore: offset + tags.length < total,
    selectedTag,
  });
});
