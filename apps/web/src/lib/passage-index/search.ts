import { z } from 'zod';
import { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { searchKnowledgeBasePage, mergeKnowledgeResults } from '../search';
import { structuredDiagnostic } from '../structured-log';
import type { PassageKind } from './build';
import type { SourceEvidenceAuthority } from '../../shared/source-evidence';
import { visiblePassageSources, passageQuery, passageLiteral, exactIdentifier } from './sql';
import { discoverKnowledgeNames } from './discovery';

export const PassageSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(20).default(8),
    sourceTypes: z
      .array(z.enum(['transcript', 'note', 'external_enrichment']))
      .min(1)
      .max(3)
      .optional(),
    sourceIds: z.array(z.string().min(1).max(256)).min(1).max(30).optional(),
  })
  .strict();
export type PassageSearchInput = z.input<typeof PassageSearchSchema>;
export type PassageHit = {
  key: string;
  sourceType: 'transcript' | 'note' | 'external_enrichment';
  sourceId: string;
  title: string;
  href: string;
  revision: string;
  documentChecksum: string;
  passageChecksum: string;
  excerpt: string;
  excerptStartOffset: number;
  excerptEndOffset: number;
  excerptStartLine: number;
  kind: PassageKind;
  authority: SourceEvidenceAuthority | null;
  section: string | null;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  startSec: number | null;
  endSec: number | null;
  matchedBy: 'exact' | 'lexical' | 'title';
};
type PassageRow = Omit<
  PassageHit,
  'excerpt' | 'excerptStartOffset' | 'excerptEndOffset' | 'excerptStartLine'
> & {
  text: string;
  rank: number;
  sourceRank: bigint;
  limitations: string[];
};
type Coverage = { total: number; indexed: number; failed: number };

function excerpt(row: PassageRow, query: string) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const terms = [query, ...(query.match(/[\p{L}\p{N}][\p{L}\p{N}._:#/+@-]*/gu) ?? [])];
  let match = -1;
  for (const term of terms) {
    match = row.text.search(new RegExp(escape(term), 'iu'));
    if (match >= 0) break;
  }
  let start = Math.max(0, match - 100),
    end = Math.min(row.text.length, start + 1200);
  const splits = (at: number) =>
    /[\uD800-\uDBFF]/.test(row.text[at - 1] ?? '') && /[\uDC00-\uDFFF]/.test(row.text[at] ?? '');
  if (splits(start)) start++;
  if (splits(end)) end--;
  return {
    excerpt: row.text.slice(start, end),
    excerptStartOffset: row.startOffset + start,
    excerptEndOffset: row.startOffset + end,
    excerptStartLine: row.startLine + (row.text.slice(0, start).match(/\n/g)?.length ?? 0),
  };
}

export async function queryPassages(userId: string, input: z.output<typeof PassageSearchSchema>) {
  const q = passageQuery(input.query),
    literal = passageLiteral(input.query);
  const exact = Prisma.sql`p.text ILIKE ${literal} ESCAPE '\\'`;
  const title = Prisma.sql`to_tsvector('pg_catalog.simple', v.title) @@ ${q}`;
  const lexical = Prisma.sql`p."searchVector" @@ ${q}`;
  const match = exactIdentifier(input.query)
    ? exact
    : Prisma.sql`(${exact} OR ${lexical} OR ${title})`;
  const rank = Prisma.sql`(CASE WHEN ${exact} THEN 100 ELSE 0 END
    + ts_rank(p."searchVector", ${q}) + CASE WHEN ${title} THEN 0.5 ELSE 0 END)`;
  return db.$queryRaw<PassageRow[]>(Prisma.sql`
    WITH visible AS (${visiblePassageSources(userId, input)}), matches AS (
      SELECT p.key, p."sourceType", p."sourceId", v.title, v.href, s.revision,
        s.checksum AS "documentChecksum", p.checksum AS "passageChecksum", p.text,
        p.kind, p.authority, p.section, p."startOffset", p."endOffset", p."startLine", p."endLine",
        p."startSec", p."endSec", s.limitations, ${rank} AS rank,
        CASE WHEN ${exact} THEN 'exact' WHEN ${lexical} THEN 'lexical' ELSE 'title' END AS "matchedBy",
        row_number() OVER (PARTITION BY p."sourceType", p."sourceId" ORDER BY ${rank} DESC, p."startOffset", p.key) AS "sourceRank"
      FROM visible v JOIN "PassageIndexSource" s
        ON s."userId" = v."userId" AND s."sourceType" = v."sourceType" AND s."sourceId" = v."sourceId"
        AND s.status = 'READY' AND s."indexedGeneration" = s.generation
      JOIN "RetrievalPassage" p ON p."userId" = s."userId" AND p."sourceType" = s."sourceType" AND p."sourceId" = s."sourceId"
      WHERE ${match}
    ) SELECT * FROM matches WHERE "sourceRank" <= 2
      ORDER BY rank DESC, "sourceType", "sourceId", "startOffset", key LIMIT ${input.limit + 1}
  `);
}

export async function passageCoverage(
  userId: string,
  input: z.output<typeof PassageSearchSchema>,
): Promise<Coverage> {
  const rows = await db.$queryRaw<Coverage[]>(Prisma.sql`
    WITH visible AS (${visiblePassageSources(userId, input)})
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s.status = 'READY' AND s."indexedGeneration" = s.generation)::int AS indexed,
      COUNT(*) FILTER (WHERE s.status = 'FAILED')::int AS failed
    FROM visible v LEFT JOIN "PassageIndexSource" s
      ON s."userId" = v."userId" AND s."sourceType" = v."sourceType" AND s."sourceId" = v."sourceId"
  `);
  return rows[0]!;
}

async function baselineSearch(userId: string, input: z.output<typeof PassageSearchSchema>) {
  if (
    !(await db.user.findFirst({ where: { id: userId, status: 'APPROVED' }, select: { id: true } }))
  )
    return { results: [], truncated: false };
  if (!input.sourceIds)
    return searchKnowledgeBasePage(userId, input.query, input.limit, {
      sourceTypes: input.sourceTypes,
    });
  const types = input.sourceTypes ?? (['transcript', 'note', 'external_enrichment'] as const);
  const pages = await Promise.all(
    types.map((type) =>
      searchKnowledgeBasePage(userId, input.query, input.limit, {
        sourceTypes: [type],
        ...(type === 'transcript'
          ? { transcriptIds: input.sourceIds }
          : type === 'note'
            ? { noteIds: input.sourceIds }
            : { enrichmentIds: input.sourceIds }),
      }),
    ),
  );
  const merged = mergeKnowledgeResults(
    pages.flatMap((p) => p.results),
    input.limit + 1,
  );
  return {
    results: merged.slice(0, input.limit),
    truncated: merged.length > input.limit || pages.some((p) => p.truncated),
  };
}

export async function searchPassages(userId: string, raw: PassageSearchInput) {
  const input = PassageSearchSchema.parse(raw),
    limitations = new Set<string>();
  let rows: PassageRow[] = [],
    coverage: Coverage | null = null;
  try {
    [rows, coverage] = await Promise.all([
      queryPassages(userId, input),
      passageCoverage(userId, input),
    ]);
    if (coverage.indexed < coverage.total) limitations.add('PARTIAL_INDEX');
    for (const row of rows) for (const code of row.limitations) limitations.add(code);
  } catch (error) {
    rows = [];
    limitations.add('INDEX_UNAVAILABLE');
    structuredDiagnostic(
      'warning',
      'passage-search-unavailable',
      'PASSAGE_INDEX_UNAVAILABLE',
      error,
    );
  }
  const baseline =
    limitations.has('PARTIAL_INDEX') || limitations.has('INDEX_UNAVAILABLE')
      ? await baselineSearch(userId, input)
      : { results: [], truncated: false };
  const discovery = rows.length
    ? { matches: [], unavailable: false }
    : await discoverKnowledgeNames(userId, input.query, input);
  if (discovery.unavailable) limitations.add('PASSAGE_DISCOVERY_UNAVAILABLE');
  return {
    results: rows.slice(0, input.limit).map((row) => {
      const {
        text: _text,
        rank: _rank,
        sourceRank: _sourceRank,
        limitations: _limitations,
        ...reference
      } = row;
      return { ...reference, ...excerpt(row, input.query) } satisfies PassageHit;
    }),
    truncated: rows.length > input.limit,
    discovery: discovery.matches,
    coverage,
    limitations: [...limitations].sort(),
    baseline: baseline.results
      .filter((p) => !input.sourceIds || input.sourceIds.includes(p.id))
      .slice(0, input.limit)
      .map((p) => ({
        id: p.id,
        sourceType: p.sourceType,
        title: p.title,
        snippet: p.snippet.slice(0, 1200),
        href: p.href,
      })),
    baselineTruncated: baseline.truncated || baseline.results.length > input.limit,
  };
}
