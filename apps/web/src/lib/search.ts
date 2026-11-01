// ============================================================================
// Busca full-text determinística (FTS) — spec 216 §3.
// ============================================================================
// Consultas lexicais Postgres (websearch_to_tsquery, dicionário português) com
// filtros validados, isolamento por workspace (TRASH nunca entra) e ordenação
// determinística (score DESC, identidade ASC). Usado pelo MCP e pela UI.
// ============================================================================

import { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { ftsSearchTranscriptEnrichments } from './retrieval-enrichments';
import {
  assertKnowledgeSearchFilters,
  assertNoteSearchFilters,
  assertTranscriptSearchFilters,
  type KnowledgeSearchFilters,
  type NoteSearchFilters,
  type TranscriptSearchFilters,
} from './search-filters';

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

export type FtsResult = {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  summary: string | null;
  tags: string[];
  folder: string | null;
  createdAt: Date;
  /** Diagnóstico interno: origem do candidato antes da apresentação ao agente. */
  retrievalSource?: 'lexical' | 'semantic' | 'hybrid';
};

export type KnowledgeSearchResult = FtsResult & {
  sourceType: 'transcript' | 'note' | 'external_enrichment';
  href: string;
};

const CURATED_NOTE_BOOST = 0.15;

const PROMPT_STOP_WORDS = new Set([
  'para',
  'com',
  'uma',
  'que',
  'como',
  'por',
  'dos',
  'das',
  'isso',
  'esta',
  'esse',
  'sobre',
  'the',
  'and',
  'from',
  'this',
  'that',
  'what',
]);

/** Converte um prompt livre numa consulta OR curta e segura para websearch_to_tsquery. */
export function promptSearchQuery(prompt: string): string {
  const words = prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[a-z0-9]{3,}/g);
  if (!words) return '';
  const unique = [...new Set(words.filter((word) => !PROMPT_STOP_WORDS.has(word)))].slice(0, 8);
  return unique.join(' OR ');
}

/**
 * Busca full-text forte nas transcrições do usuário (Postgres FTS, dicionário
 * português): ts_headline (trecho destacado) + ts_rank (relevância). Retorna
 * trechos curtos, NUNCA o texto completo. Espelha voxen_search_transcripts.
 */
export async function queryTranscriptFts(
  userId: string,
  query: string,
  limit: number,
  filters: TranscriptSearchFilters = {},
  client: Pick<typeof db, '$queryRaw'> = db,
): Promise<FtsResult[]> {
  const q = query.trim();
  if (!q) return [];
  // Max 26: o teto público é 25, mas a sonda take+1 da página precisa de uma
  // linha extra para sinalizar truncamento sem outra consulta.
  const take = clampInt(limit, 8, 1, 26);
  assertTranscriptSearchFilters(filters);
  const conditions: Prisma.Sql[] = [];
  if (filters.sources?.length) {
    conditions.push(Prisma.sql`t.source = ANY(${[...filters.sources]}::"TranscriptSource"[])`);
  }
  if (filters.language) {
    conditions.push(Prisma.sql`t.language = ${filters.language.toLowerCase()}`);
  }
  if (filters.publishedAfter)
    conditions.push(Prisma.sql`t."publishedAt" >= ${filters.publishedAfter}`);
  if (filters.publishedBefore)
    conditions.push(Prisma.sql`t."publishedAt" < ${filters.publishedBefore}`);
  if (filters.createdAfter) conditions.push(Prisma.sql`t."createdAt" >= ${filters.createdAfter}`);
  if (filters.createdBefore) conditions.push(Prisma.sql`t."createdAt" < ${filters.createdBefore}`);
  if (filters.folderId) conditions.push(Prisma.sql`t."folderId" = ${filters.folderId}`);
  if (filters.transcriptIds?.length) {
    conditions.push(Prisma.sql`t.id = ANY(${[...filters.transcriptIds]}::text[])`);
  }
  if (filters.tags?.length) {
    const names = [...new Set(filters.tags.map((tag) => tag.trim().toLowerCase()))];
    conditions.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM "TranscriptTag" tt
        JOIN "Tag" tag ON tag.id = tt."tagId" AND tag."userId" = t."userId"
        WHERE tt."transcriptId" = t.id
          AND (tag.slug = ANY(${names}::text[]) OR LOWER(tag.name) = ANY(${names}::text[]))
      )
    `);
  }
  const statusClause = filters.includeArchived
    ? Prisma.sql`t.status IN ('ACTIVE'::"ContentStatus", 'ARCHIVED'::"ContentStatus")`
    : Prisma.sql`t.status = 'ACTIVE'::"ContentStatus"`;
  const extra =
    conditions.length > 0 ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  return client.$queryRaw<FtsResult[]>`
    SELECT t.id, t.title,
      ts_headline('portuguese', concat_ws(E'\n\n', t.title, CASE WHEN t."correctionState" = 'ACTIVE'::"TranscriptCorrectionState" THEN coalesce(t."correctedPlainText", t."plainText") ELSE t."plainText" END), websearch_to_tsquery('portuguese', ${q}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
      ts_rank(t."searchVector", websearch_to_tsquery('portuguese', ${q})) AS rank,
      LEFT(t."summaryMd", 800) AS summary,
      folder.name AS folder,
      t."createdAt",
      COALESCE((
        SELECT array_agg(tag.name ORDER BY tag.name)
        FROM "TranscriptTag" tt
        JOIN "Tag" tag ON tag.id = tt."tagId" AND tag."userId" = t."userId"
        WHERE tt."transcriptId" = t.id
      ), ARRAY[]::text[]) AS tags
    FROM "Transcript" t
    LEFT JOIN "LibraryFolder" folder ON folder.id = t."folderId" AND folder."userId" = t."userId"
    WHERE t."userId" = ${userId}
      AND ${statusClause}
      AND t."searchVector" @@ websearch_to_tsquery('portuguese', ${q})
      ${extra}
    ORDER BY rank DESC, t.id ASC
    LIMIT ${take}
  `;
}

export async function ftsSearchTranscripts(
  userId: string,
  query: string,
  limit: number,
  filters: TranscriptSearchFilters = {},
): Promise<FtsResult[]> {
  const q = query.trim();
  if (!q) return [];
  // Max 26: o teto público é 25, mas a sonda take+1 da página precisa de uma
  // linha extra para sinalizar truncamento sem outra consulta.
  const take = clampInt(limit, 8, 1, 26);
  // Lexical FTS only (spec 215): no built-in embedding inference or
  // semantic-rescue execution.
  return queryTranscriptFts(userId, q, take, filters);
}

/** Busca FTS nas notas manuais do workspace com o mesmo parser usado nas transcrições. */
export async function ftsSearchNotes(
  userId: string,
  query: string,
  limit: number,
  filters: NoteSearchFilters = {},
): Promise<KnowledgeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  // Max 26: o teto público é 25, mas a sonda take+1 da página precisa de uma
  // linha extra para sinalizar truncamento sem outra consulta.
  const take = clampInt(limit, 8, 1, 26);
  assertNoteSearchFilters(filters);
  const conditions: Prisma.Sql[] = [];
  if (filters.noteIds?.length) {
    conditions.push(Prisma.sql`n.id = ANY(${[...filters.noteIds]}::text[])`);
  }
  if (filters.createdAfter) conditions.push(Prisma.sql`n."createdAt" >= ${filters.createdAfter}`);
  if (filters.createdBefore) conditions.push(Prisma.sql`n."createdAt" < ${filters.createdBefore}`);
  const extra =
    conditions.length > 0 ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  type NoteRow = {
    id: string;
    title: string;
    snippet: string;
    rank: number;
    createdAt: Date;
  };
  const rows = await db.$queryRaw<NoteRow[]>`
    SELECT n.id, n.title,
      ts_headline('portuguese', concat_ws(E'\n\n', n.title, n.content), websearch_to_tsquery('portuguese', ${q}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
      ts_rank(n."searchVector", websearch_to_tsquery('portuguese', ${q})) AS rank,
      n."createdAt"
    FROM "Note" n
    WHERE n."userId" = ${userId}
      AND n.kind = 'NOTE'::"NoteKind"
      AND n."searchVector" @@ websearch_to_tsquery('portuguese', ${q})
      ${extra}
    ORDER BY rank DESC, n.id ASC
    LIMIT ${take}
  `;
  return rows.map((row) => ({
    ...row,
    sourceType: 'note' as const,
    href: `/notas/${row.id}`,
    summary: null,
    tags: [],
    folder: null,
  }));
}

/**
 * Junta resultados da Base de conhecimento. Notas são curadoria humana e recebem
 * um bônus pequeno, calculado sobre o melhor score da consulta, para vencer só
 * resultados de transcrição comparáveis — nunca uma fonte muito mais precisa.
 */
export function mergeKnowledgeResults(
  items: readonly KnowledgeSearchResult[],
  limit = 8,
): KnowledgeSearchResult[] {
  // Max 26: acompanha a sonda take+1 da página; o teto público segue 25.
  const take = clampInt(limit, 8, 1, 26);
  const bestRank = Math.max(0, ...items.map((item) => Number(item.rank) || 0));
  return [...items]
    .sort((a, b) => {
      const aScore = a.rank + (a.sourceType === 'note' ? bestRank * CURATED_NOTE_BOOST : 0);
      const bScore = b.rank + (b.sourceType === 'note' ? bestRank * CURATED_NOTE_BOOST : 0);
      if (bScore !== aScore) return bScore - aScore;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    })
    .slice(0, take);
}

/** Busca unificada da Base de conhecimento, escopada por workspace.
 *
 * Filtros de origem/idioma/datas/tags/pasta/documentos de transcrição valem
 * para transcrições e contexto aceito; notas usam só note_ids e datas
 * (notas não têm origem/idioma/tags/pasta) e por isso não são restringidas
 * pelos filtros exclusivos de transcrição. Lixeira nunca entra.
 */
export async function searchKnowledgeBase(
  userId: string,
  query: string,
  limit = 8,
  filters: KnowledgeSearchFilters = {},
): Promise<KnowledgeSearchResult[]> {
  return (await searchKnowledgeBasePage(userId, query, limit, filters)).results;
}

/** Variante paginada: busca take+1 por fonte e sinaliza truncamento explícito.
 *
 * Uma página cheia (results.length === limit) com truncated=false significa
 * que não há mais candidatos; truncated=true exige nova busca mais estreita
 * ou continuação paginada — nunca presumir enumeração completa.
 */
export async function searchKnowledgeBasePage(
  userId: string,
  query: string,
  limit = 8,
  filters: KnowledgeSearchFilters = {},
): Promise<{ results: KnowledgeSearchResult[]; truncated: boolean }> {
  const take = clampInt(limit, 8, 1, 25);
  assertKnowledgeSearchFilters(filters);
  const wanted = (type: 'transcript' | 'note' | 'external_enrichment'): boolean =>
    !filters.sourceTypes || filters.sourceTypes.includes(type);
  const [transcripts, notes, enrichments] = await Promise.all([
    wanted('transcript')
      ? ftsSearchTranscripts(userId, query, take + 1, filters)
      : Promise.resolve([]),
    wanted('note') ? ftsSearchNotes(userId, query, take + 1, filters) : Promise.resolve([]),
    wanted('external_enrichment')
      ? ftsSearchTranscriptEnrichments(userId, query, take + 1, filters)
      : Promise.resolve([]),
  ]);
  const merged = mergeKnowledgeResults(
    [
      ...transcripts.map((item) => ({
        ...item,
        sourceType: 'transcript' as const,
        href: `/transcricoes/${item.id}`,
      })),
      ...notes,
      ...enrichments,
    ],
    take + 1,
  );
  return { results: merged.slice(0, take), truncated: merged.length > take };
}

/** Pré-busca best-effort usada pelo harness antes do primeiro step do modelo. */
export async function preloadRelevantContent(
  userId: string,
  prompt: string,
  limit = 5,
): Promise<KnowledgeSearchResult[]> {
  const query = promptSearchQuery(prompt);
  if (!query) return [];
  return searchKnowledgeBase(userId, query, limit);
}
