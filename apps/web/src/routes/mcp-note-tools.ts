import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/server';
import { db } from '../lib/db';
import { noteContentChecksum } from '../lib/note-revisions';
import { bounded, fail, ok, READ_ONLY, toMcpContentUrl } from './mcp-tool-helpers';
import { decodeMcpPageCursor, encodeMcpPageCursor, mcpPageBoundary } from './mcp-page-cursor';
import { registerMcpNoteRevisionReadTools } from './mcp-note-revision-read-tools';

export function registerNoteTools(server: McpServer, userId: string, publicOrigin: string): void {
  server.registerTool(
    'voxen_search_notes',
    {
      title: 'Buscar nas notas',
      description:
        'Busca full-text nas notas manuais do usuário (a KB escrita à mão, separada das ' +
        'transcrições). Retorna trechos curtos + id. Depois use voxen_read_note para ler.',
      inputSchema: {
        query: z.string().min(1).describe('Termos de busca em português.'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. resultados (padrão 8).'),
      },
      outputSchema: {
        results: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            snippet: z.string(),
            rank: z.number(),
            revision: z.number(),
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Buscar nas notas' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const limit = bounded(args.limit, 8, 1, 25);
      type Row = { id: string; title: string; snippet: string; rank: number; revision: number };
      const rows = await db.$queryRaw<Row[]>`
        SELECT id, title, revision,
          ts_headline('portuguese', coalesce(content, ''), plainto_tsquery('portuguese', ${query}),
            'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
          ts_rank("searchVector", plainto_tsquery('portuguese', ${query})) AS rank
        FROM "Note"
        WHERE "userId" = ${userId}
          AND kind = 'NOTE'
          AND "searchVector" @@ plainto_tsquery('portuguese', ${query})
        ORDER BY rank DESC, "updatedAt" DESC
        LIMIT ${limit}
      `;
      return ok({ results: rows });
    },
  );

  server.registerTool(
    'voxen_list_notes',
    {
      title: 'Listar notas',
      description:
        'Lista notas e pastas do usuário por data de criação (mais recentes primeiro), com paginação por cursor. ' +
        '`kind` indica se é NOTE ou FOLDER; `parentId` dá a hierarquia.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Itens por página (padrão 30).'),
        cursor: z
          .string()
          .max(2048)
          .optional()
          .describe('Cursor opaco da página seguinte (nextCursor).'),
        transcript_id: z
          .string()
          .min(1)
          .optional()
          .describe('Retorna somente notas vinculadas a esta transcrição do usuário.'),
      },
      outputSchema: {
        notes: z.array(
          z.object({
            id: z.string(),
            parentId: z.string().nullable(),
            kind: z.string(),
            title: z.string(),
            updatedAt: z.string(),
            href: z.string(),
            anchors: z.array(
              z.object({
                id: z.string(),
                transcriptId: z.string(),
                startLine: z.number().nullable(),
                endLine: z.number().nullable(),
                startSec: z.number().nullable(),
                endSec: z.number().nullable(),
                selectedQuote: z.string(),
                status: z.string(),
                href: z.string(),
              }),
            ),
          }),
        ),
        nextCursor: z.string().nullable(),
      },
    },
    async (args) => {
      const limit = bounded(args.limit, 30, 1, 100);
      const pageContext = { userId, tool: 'notes' as const, transcriptId: args.transcript_id };
      const page = decodeMcpPageCursor(args.cursor, pageContext);
      if (!page.valid) return fail('MCP_INVALID_CURSOR: Restart pagination without a cursor.');
      const rows = await db.note.findMany({
        where: {
          userId,
          ...mcpPageBoundary(page.position),
          ...(args.transcript_id
            ? { transcriptSources: { some: { transcriptId: args.transcript_id, userId } } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          parentId: true,
          kind: true,
          title: true,
          updatedAt: true,
          createdAt: true,
          transcriptSources: {
            where: args.transcript_id ? { transcriptId: args.transcript_id, userId } : { userId },
            select: {
              transcriptId: true,
              anchors: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  startLine: true,
                  endLine: true,
                  startSec: true,
                  endSec: true,
                  selectedQuote: true,
                  status: true,
                },
              },
            },
          },
        },
      });
      const selected = rows.slice(0, limit);
      const notes = selected.map((note) => ({
        id: note.id,
        parentId: note.parentId,
        kind: note.kind,
        title: note.title,
        updatedAt: note.updatedAt.toISOString(),
        href: toMcpContentUrl(publicOrigin, `/notas/${note.id}`),
        anchors: note.transcriptSources.flatMap((source) =>
          source.anchors.map((anchor) => ({
            ...anchor,
            transcriptId: source.transcriptId,
            href: toMcpContentUrl(
              publicOrigin,
              `/transcricoes/${source.transcriptId}${anchor.startLine ? `#l=${anchor.startLine}-${anchor.endLine ?? anchor.startLine}` : anchor.startSec !== null ? `#t=${anchor.startSec}-${anchor.endSec ?? anchor.startSec}` : ''}`,
            ),
          })),
        ),
      }));
      return ok({
        notes,
        nextCursor:
          rows.length > limit
            ? encodeMcpPageCursor(selected[selected.length - 1]!, pageContext)
            : null,
      });
    },
  );

  server.registerTool(
    'voxen_read_note',
    {
      title: 'Ler nota',
      description: 'Lê o conteúdo markdown completo de uma nota pelo `note_id`.',
      inputSchema: { note_id: z.string().min(1).describe('ID da nota a ler.') },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        content: z.string().nullable(),
        kind: z.string(),
        revision: z.number(),
        checksum: z.string(),
        href: z.string(),
        sources: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            href: z.string(),
            url: z.string(),
            anchors: z.array(
              z.object({
                id: z.string(),
                startLine: z.number().nullable(),
                endLine: z.number().nullable(),
                startSec: z.number().nullable(),
                endSec: z.number().nullable(),
                selectedQuote: z.string(),
                sourceVersion: z.number(),
                sourceChecksum: z.string().nullable(),
                status: z.string(),
                staleReason: z.string().nullable(),
                href: z.string(),
              }),
            ),
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Ler nota' },
    },
    async (args) => {
      const note = await db.note.findFirst({
        where: { id: args.note_id, userId },
        select: {
          id: true,
          title: true,
          content: true,
          kind: true,
          revision: true,
          transcriptSources: {
            orderBy: { createdAt: 'asc' },
            select: {
              transcriptId: true,
              transcript: { select: { title: true, url: true } },
              anchors: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  startLine: true,
                  endLine: true,
                  startSec: true,
                  endSec: true,
                  selectedQuote: true,
                  sourceVersion: true,
                  sourceChecksum: true,
                  status: true,
                  staleReason: true,
                },
              },
            },
          },
        },
      });
      if (!note) return fail('Nota não encontrada (ou fora do escopo do token).');
      return ok({
        id: note.id,
        title: note.title,
        content: note.content,
        kind: note.kind,
        revision: note.revision,
        checksum: noteContentChecksum(note.title, note.content),
        href: toMcpContentUrl(publicOrigin, `/notas/${note.id}`),
        sources: note.transcriptSources.map((source) => ({
          id: source.transcriptId,
          title: source.transcript.title,
          href: toMcpContentUrl(publicOrigin, `/transcricoes/${source.transcriptId}`),
          url: source.transcript.url,
          anchors: source.anchors.map((anchor) => ({
            ...anchor,
            href: toMcpContentUrl(
              publicOrigin,
              `/transcricoes/${source.transcriptId}${anchor.startLine ? `#l=${anchor.startLine}-${anchor.endLine ?? anchor.startLine}` : anchor.startSec !== null ? `#t=${anchor.startSec}-${anchor.endSec ?? anchor.startSec}` : ''}`,
            ),
          })),
        })),
      });
    },
  );

  registerMcpNoteRevisionReadTools(server, userId);
}
