import { Prisma } from '../../prisma-generated/client';

const MIN_GRAPH_QUERY_LENGTH = 3;
export const TRANSCRIPT_GRAPH_RANK_BOOST = 0.03;

export type TranscriptSearchRow = {
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
  graphMatch: boolean;
};

/**
 * Expande a busca apenas por conceitos ativos que possuam evidência da
 * transcrição no mesmo workspace. Consultas muito curtas ficam no FTS/tags:
 * substring de duas letras em descrições de nós produz mais ruído que recall.
 */
export function transcriptGraphMatchSql(userId: string, query: string): Prisma.Sql {
  if (query.trim().length < MIN_GRAPH_QUERY_LENGTH) return Prisma.sql`FALSE`;
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "BrainSource" bs
      JOIN "BrainNode" bn
        ON bn.id = bs."nodeId"
       AND bn."userId" = ${userId}
       AND bn.status = 'ACTIVE'::"ContentStatus"
      WHERE bs."userId" = ${userId}
        AND bs."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
        AND bs."sourceId" = t.id
        AND (
          strpos(lower(bn.label), lower(${query})) > 0
          OR strpos(lower(COALESCE(bn.description, '')), lower(${query})) > 0
        )
    )
  `;
}
