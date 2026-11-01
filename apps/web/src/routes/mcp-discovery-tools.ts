// ============================================================================
// Discovery catalog (spec 217 §4, issue #898).
// ============================================================================
// Name/topic/collection lookup over indexed metadata — complementary to
// full-text passage search, which reads body text. Cards are derived
// deterministically from stored title/metadata/tags/folders (no model calls,
// no enrichment required) and carry producer provenance where the prepared
// contract supplied it. A missing card never excludes original passages:
// use voxen_search_* to search body text. Bounded, owner-scoped, deterministic
// order (exact > prefix > contains, then identity).
// ============================================================================

import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/server';
import { db } from '../lib/db';
import { bounded, fail, ok, READ_ONLY, toMcpContentUrl } from './mcp-tool-helpers';

type DiscoverCard = {
  id: string;
  kind: 'note' | 'transcript';
  title: string;
  description: string;
  topics: string[];
  collection: string | null;
  identifiers: Record<string, string>;
  provenance: Record<string, string>;
  href: string;
};

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function matchScore(title: string, query: string): number {
  const normalized = title.trim().toLowerCase();
  if (normalized === query) return 3;
  if (normalized.startsWith(query)) return 2;
  if (normalized.includes(query)) return 1;
  return 0;
}

export function registerDiscoveryTools(
  server: McpServer,
  userId: string,
  publicOrigin: string,
): void {
  server.registerTool(
    'voxen_discover',
    {
      title: 'Descobrir no catálogo',
      description:
        'Localiza documentos pelo NOME (título exato, prefixo ou trecho), tópicos (tags) e ' +
        'coleções (pastas) — sem ler o texto corrido. Use para navegar quando souber o nome, ' +
        'o tópico ou a pasta; use voxen_search_knowledge para passagens no corpo do texto. ' +
        'Cartões derivam de metadados armazenados, sem modelo nem enriquecimento obrigatório. ' +
        'truncated=true indica mais candidatos que o limite.',
      inputSchema: {
        query: z.string().min(1).describe('Nome, tópico ou coleção a localizar.'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. cartões (padrão 8).'),
      },
      outputSchema: {
        cards: z.array(
          z.object({
            id: z.string(),
            kind: z.enum(['note', 'transcript']),
            title: z.string(),
            description: z.string(),
            topics: z.array(z.string()),
            collection: z.string().nullable(),
            identifiers: z.record(z.string(), z.string()),
            provenance: z.record(z.string(), z.string()),
            href: z.string(),
          }),
        ),
        topics: z
          .array(z.string())
          .describe('Tags que casam com a consulta (ordem alfabética, até 20).'),
        collections: z
          .array(z.string())
          .describe('Pastas que casam com a consulta (ordem alfabética, até 20).'),
        truncated: z
          .boolean()
          .describe(
            'true quando há mais candidatos que o limite; refine a consulta em vez de presumir enumeração completa.',
          ),
      },
      annotations: { ...READ_ONLY, title: 'Descobrir no catálogo' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const take = bounded(args.limit, 8, 1, 25);
      const lowered = query.toLowerCase();
      const pattern = `%${escapeLike(query)}%`;
      const prefixPattern = `${escapeLike(query.toLowerCase())}%`;

      type NoteRow = {
        id: string;
        title: string;
        content: string;
        collection: string | null;
      };
      const notes = await db.$queryRaw<NoteRow[]>`
        SELECT n.id, n.title, substr(n.content, 1, 200) AS "content",
          parent.title AS collection
        FROM "Note" n
        LEFT JOIN "Note" parent ON parent.id = n."parentId" AND parent."userId" = n."userId" AND parent.kind = 'FOLDER'::"NoteKind"
        WHERE n."userId" = ${userId}
          AND n.kind = 'NOTE'::"NoteKind"
          AND n.title ILIKE ${pattern} ESCAPE '\\'
        ORDER BY
          CASE WHEN LOWER(n.title) = ${lowered} THEN 0
               WHEN LOWER(n.title) LIKE ${prefixPattern} ESCAPE '\\' THEN 1
               ELSE 2 END,
          n.id ASC
        LIMIT ${take + 1}
      `;

      type TranscriptRow = {
        id: string;
        title: string;
        url: string;
        source: string;
        summary: string | null;
        plainText: string;
        tags: string[];
        folder: string | null;
      };
      const transcripts = await db.$queryRaw<TranscriptRow[]>`
        SELECT t.id, t.title, t.url, t.source::text AS source,
          t."summaryMd" AS summary, substr(t."plainText", 1, 200) AS "plainText",
          COALESCE((
            SELECT array_agg(tag.name ORDER BY tag.name)
            FROM "TranscriptTag" tt
            JOIN "Tag" tag ON tag.id = tt."tagId" AND tag."userId" = t."userId"
            WHERE tt."transcriptId" = t.id
          ), ARRAY[]::text[]) AS tags,
          folder.name AS folder
        FROM "Transcript" t
        LEFT JOIN "LibraryFolder" folder ON folder.id = t."folderId" AND folder."userId" = t."userId"
        WHERE t."userId" = ${userId}
          AND t.status = 'ACTIVE'::"ContentStatus"
          AND t.title ILIKE ${pattern} ESCAPE '\\'
        ORDER BY
          CASE WHEN LOWER(t.title) = ${lowered} THEN 0
               WHEN LOWER(t.title) LIKE ${prefixPattern} ESCAPE '\\' THEN 1
               ELSE 2 END,
          t.id ASC
        LIMIT ${take + 1}
      `;

      type NameRow = { name: string };
      const [tagRows, folderRows] = await Promise.all([
        db.$queryRaw<NameRow[]>`
          SELECT name FROM "Tag"
          WHERE "userId" = ${userId} AND name ILIKE ${pattern} ESCAPE '\\'
          ORDER BY name ASC
          LIMIT 21
        `,
        db.$queryRaw<NameRow[]>`
          SELECT name FROM "LibraryFolder"
          WHERE "userId" = ${userId} AND name ILIKE ${pattern} ESCAPE '\\'
          ORDER BY name ASC
          LIMIT 21
        `,
      ]);

      const noteIds = notes.map((row) => row.id);
      const preparedKeys =
        noteIds.length > 0
          ? await db.preparedIngestKey.findMany({
              where: { userId, targetType: 'NOTE', targetId: { in: noteIds } },
              select: { targetId: true, producerId: true, externalId: true },
            })
          : [];
      const provenanceByNote = new Map(
        preparedKeys.map((key) => [
          key.targetId,
          {
            ...(key.producerId ? { producerId: key.producerId } : {}),
            ...(key.externalId ? { externalId: key.externalId } : {}),
          },
        ]),
      );

      const scored: Array<{ score: number; card: DiscoverCard }> = [];
      for (const row of notes) {
        const score = matchScore(row.title, lowered);
        if (score === 0) continue;
        scored.push({
          score,
          card: {
            id: row.id,
            kind: 'note',
            title: row.title,
            description: row.content,
            topics: [],
            collection: row.collection,
            identifiers: {},
            provenance: provenanceByNote.get(row.id) ?? {},
            href: toMcpContentUrl(publicOrigin, `/notas/${row.id}`),
          },
        });
      }
      for (const row of transcripts) {
        const score = matchScore(row.title, lowered);
        if (score === 0) continue;
        scored.push({
          score,
          card: {
            id: row.id,
            kind: 'transcript',
            title: row.title,
            description: row.summary ?? row.plainText,
            topics: row.tags,
            collection: row.folder,
            identifiers: { url: row.url },
            provenance: { source: row.source },
            href: toMcpContentUrl(publicOrigin, `/transcricoes/${row.id}`),
          },
        });
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.card.id < b.card.id) return -1;
        if (a.card.id > b.card.id) return 1;
        return 0;
      });
      return ok({
        cards: scored.slice(0, take).map((item) => item.card),
        topics: tagRows.slice(0, 20).map((row) => row.name),
        collections: folderRows.slice(0, 20).map((row) => row.name),
        truncated: scored.length > take || tagRows.length > 20 || folderRows.length > 20,
      });
    },
  );
}
