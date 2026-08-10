import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../lib/db';
import { noteContentChecksum, searchWithinNote } from '../lib/note-revisions';
import { bounded, fail, ok, READ_ONLY } from './mcp-tool-helpers';

export function registerMcpNoteRevisionReadTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_search_note_content',
    {
      title: 'Buscar dentro de uma nota',
      description:
        'Localiza uma passagem exata dentro de uma nota e retorna ocorrências, offsets, linhas, ' +
        'contexto, revision e checksum. Use antes de propor voxen_patch_note.',
      inputSchema: {
        note_id: z.string().min(1),
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(100).optional(),
      },
      outputSchema: {
        noteId: z.string(),
        title: z.string(),
        revision: z.number(),
        checksum: z.string(),
        query: z.string(),
        matches: z.array(
          z.object({
            occurrence: z.number(),
            start: z.number(),
            end: z.number(),
            line: z.number(),
            matchedText: z.string(),
            context: z.string(),
            contextStart: z.number(),
            contextEnd: z.number(),
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Buscar dentro de uma nota' },
    },
    async (args) => {
      const note = await db.note.findFirst({
        where: { id: args.note_id, userId, kind: 'NOTE' },
        select: { id: true, title: true, content: true, revision: true },
      });
      if (!note) return fail('Nota não encontrada (ou fora do escopo do token).');
      const query = args.query.trim();
      return ok({
        noteId: note.id,
        title: note.title,
        revision: note.revision,
        checksum: noteContentChecksum(note.title, note.content),
        query,
        matches: searchWithinNote(note.content, query, { limit: bounded(args.limit, 20, 1, 100) }),
      });
    },
  );

  server.registerTool(
    'voxen_list_note_revisions',
    {
      title: 'Listar revisões de uma nota',
      description:
        'Lista até 100 snapshots imutáveis de título/conteúdo. Use revision com ' +
        'voxen_read_note_revision para inspecionar antes de restaurar.',
      inputSchema: {
        note_id: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      },
      outputSchema: {
        revisions: z.array(
          z.object({
            revision: z.number(),
            title: z.string(),
            checksum: z.string(),
            actor: z.string(),
            changeSummary: z.string().nullable(),
            createdAt: z.string(),
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Listar revisões de uma nota' },
    },
    async (args) => {
      const note = await db.note.findFirst({
        where: { id: args.note_id, userId },
        select: { id: true },
      });
      if (!note) return fail('Nota não encontrada (ou fora do escopo do token).');
      const rows = await db.noteRevision.findMany({
        where: { noteId: note.id, userId },
        orderBy: { revision: 'desc' },
        take: bounded(args.limit, 30, 1, 100),
        select: {
          revision: true,
          title: true,
          checksum: true,
          actor: true,
          changeSummary: true,
          createdAt: true,
        },
      });
      return ok({
        revisions: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      });
    },
  );

  server.registerTool(
    'voxen_read_note_revision',
    {
      title: 'Ler revisão de uma nota',
      description: 'Lê o título e markdown imutáveis de uma revisão histórica da própria nota.',
      inputSchema: { note_id: z.string().min(1), revision: z.number().int().min(1) },
      outputSchema: {
        noteId: z.string(),
        revision: z.number(),
        title: z.string(),
        content: z.string(),
        checksum: z.string(),
        actor: z.string(),
        changeSummary: z.string().nullable(),
        createdAt: z.string(),
      },
      annotations: { ...READ_ONLY, title: 'Ler revisão de uma nota' },
    },
    async (args) => {
      const snapshot = await db.noteRevision.findFirst({
        where: { noteId: args.note_id, userId, revision: args.revision },
        select: {
          noteId: true,
          revision: true,
          title: true,
          content: true,
          checksum: true,
          actor: true,
          changeSummary: true,
          createdAt: true,
        },
      });
      if (!snapshot) return fail('Revisão não encontrada (ou fora do escopo do token).');
      return ok({ ...snapshot, createdAt: snapshot.createdAt.toISOString() });
    },
  );
}
