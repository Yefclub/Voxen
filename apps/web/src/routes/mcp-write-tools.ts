import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../lib/db';
import { getTranscriptBrief } from '../lib/agent-content';
import {
  NoteAnchorValidationError,
  noteSourceCreateData,
  validateNoteAnchors,
  type NoteAnchorInput,
} from '../lib/note-anchors';
import { noteContentChecksum } from '../lib/note-revisions';
import {
  NoteRevisionConflictError,
  commitNoteVersion,
  recordInitialNoteRevision,
  syncNoteGraph,
} from '../lib/note-versioning';
import { createAutoJobForUser, createAutoJobsForUser } from './jobs';
import { fail, ok } from './mcp-tool-helpers';
import { registerMcpNoteRevisionWriteTools } from './mcp-note-revision-write-tools';
import { TRANSCRIPT_BRIEF_SCHEMA } from './mcp-transcription-schemas';
import { noteWriteFailure } from './mcp-note-write-errors';
import { registerMcpTranscriptCorrectionWriteTools } from './mcp-transcript-correction-tools';

const MCP_NOTE_ANCHOR_SCHEMA = z.object({
  transcript_id: z.string().min(1),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  start_sec: z.number().int().min(0).optional(),
  end_sec: z.number().int().min(0).optional(),
  selected_quote: z.string().min(1).max(20_000),
  source_version: z.number().int().min(0).optional(),
  source_checksum: z.string().max(256).nullable().optional(),
});

function toNoteAnchorInputs(
  anchors: readonly z.infer<typeof MCP_NOTE_ANCHOR_SCHEMA>[] | undefined,
): NoteAnchorInput[] {
  return (anchors ?? []).map((anchor) => ({
    transcriptId: anchor.transcript_id,
    startLine: anchor.start_line,
    endLine: anchor.end_line,
    startSec: anchor.start_sec,
    endSec: anchor.end_sec,
    selectedQuote: anchor.selected_quote,
    sourceVersion: anchor.source_version,
    sourceChecksum: anchor.source_checksum,
  }));
}

export function registerWriteTools(server: McpServer, userId: string): void {
  registerMcpNoteRevisionWriteTools(server, userId);
  registerMcpTranscriptCorrectionWriteTools(server, userId);
  server.registerTool(
    'voxen_create_note',
    {
      title: 'Criar nota',
      description:
        'Cria uma nota (markdown) na KB do usuário. Use para salvar/ingerir informação que ' +
        'o usuário pediu para guardar. Retorna o id da nota criada.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Título da nota.'),
        content: z.string().max(200_000).optional().describe('Conteúdo markdown.'),
        source_transcript_ids: z
          .array(z.string().min(1))
          .max(50)
          .optional()
          .describe('IDs de transcrições da própria Base de conhecimento que sustentam a nota.'),
        source_anchors: z
          .array(MCP_NOTE_ANCHOR_SCHEMA)
          .max(100)
          .optional()
          .describe('Passagens verificadas por linhas e/ou timestamps que sustentam a nota.'),
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        revision: z.number(),
        checksum: z.string(),
        graphSync: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        title: 'Criar nota',
      },
    },
    async (args) => {
      const title = args.title.trim();
      if (!title) return fail('Título obrigatório.');
      const anchorInputs = toNoteAnchorInputs(args.source_anchors);
      const transcriptIds = await resolveMcpTranscriptSourceIds(userId, [
        ...(args.source_transcript_ids ?? []),
        ...anchorInputs.map((anchor) => anchor.transcriptId),
      ]);
      if (transcriptIds === null) {
        return fail('Uma ou mais transcrições de origem não existem na sua Base de conhecimento.');
      }
      let anchors;
      try {
        anchors = await validateNoteAnchors(userId, anchorInputs);
      } catch (error) {
        if (error instanceof NoteAnchorValidationError) return fail(error.message);
        throw error;
      }
      const note = await db.$transaction(async (tx) => {
        const created = await tx.note.create({
          data: {
            userId,
            kind: 'NOTE',
            title,
            content: args.content ?? '',
            sourceType: transcriptIds.length > 0 ? 'TRANSCRIPT' : null,
            sourceId: transcriptIds[0] ?? null,
            ...(transcriptIds.length > 0
              ? {
                  transcriptSources: {
                    create: noteSourceCreateData(userId, transcriptIds, anchors),
                  },
                }
              : {}),
          },
        });
        await recordInitialNoteRevision(tx, created, 'MCP');
        return created;
      });
      const graphSync = await syncNoteGraph(userId, note.id);
      return ok({
        id: note.id,
        title: note.title,
        revision: note.revision,
        checksum: noteContentChecksum(note.title, note.content),
        graphSync,
      });
    },
  );

  server.registerTool(
    'voxen_update_note',
    {
      title: 'Editar nota',
      description:
        'Atualiza título, conteúdo e/ou fontes de uma nota existente. Requer expected_revision ' +
        'obtida por voxen_read_note para impedir sobrescrita concorrente. Para mudanças pontuais, ' +
        'prefira voxen_patch_note.',
      inputSchema: {
        note_id: z.string().min(1).describe('ID da nota a editar.'),
        expected_revision: z
          .number()
          .int()
          .min(1)
          .describe('Revisão retornada pela última leitura da nota.'),
        title: z.string().min(1).max(200).optional().describe('Novo título.'),
        content: z.string().max(200_000).optional().describe('Novo conteúdo markdown.'),
        source_transcript_ids: z
          .array(z.string().min(1))
          .max(50)
          .optional()
          .describe('Substitui as transcrições de origem da nota; array vazio remove os vínculos.'),
        source_anchors: z
          .array(MCP_NOTE_ANCHOR_SCHEMA)
          .max(100)
          .optional()
          .describe('Substitui as passagens ancoradas e preserva os demais IDs informados.'),
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        revision: z.number(),
        checksum: z.string(),
        graphSync: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Editar nota',
      },
    },
    async (args) => {
      if (
        args.title === undefined &&
        args.content === undefined &&
        args.source_transcript_ids === undefined &&
        args.source_anchors === undefined
      ) {
        return fail(
          'Nada para atualizar: informe title, content, source_transcript_ids e/ou source_anchors.',
        );
      }
      if (args.title !== undefined && !args.title.trim()) return fail('Título não pode ser vazio.');
      const existing = await db.note.findFirst({
        where: { id: args.note_id, userId, kind: 'NOTE' },
        select: {
          id: true,
          revision: true,
          title: true,
          content: true,
          transcriptSources: { select: { transcriptId: true } },
        },
      });
      if (!existing) return fail('Nota não encontrada (ou não é editável).');
      if (existing.revision !== args.expected_revision) {
        return noteWriteFailure(
          new NoteRevisionConflictError(
            existing.revision,
            noteContentChecksum(existing.title, existing.content),
          ),
        ) as ReturnType<typeof fail>;
      }
      const anchorInputs = toNoteAnchorInputs(args.source_anchors);
      const replaceSources =
        args.source_transcript_ids !== undefined || args.source_anchors !== undefined;
      const transcriptIds = !replaceSources
        ? undefined
        : await resolveMcpTranscriptSourceIds(userId, [
            ...(args.source_transcript_ids ??
              (args.source_anchors !== undefined
                ? existing.transcriptSources.map((source) => source.transcriptId)
                : [])),
            ...anchorInputs.map((anchor) => anchor.transcriptId),
          ]);
      if (transcriptIds === null) {
        return fail('Uma ou mais transcrições de origem não existem na sua Base de conhecimento.');
      }
      let anchors;
      try {
        anchors = await validateNoteAnchors(userId, anchorInputs);
      } catch (error) {
        if (error instanceof NoteAnchorValidationError) return fail(error.message);
        throw error;
      }
      try {
        const note = await commitNoteVersion({
          userId,
          noteId: existing.id,
          expectedRevision: args.expected_revision,
          actor: 'MCP',
          changeSummary: 'Full note update through MCP',
          changes: {
            ...(args.title !== undefined ? { title: args.title.trim() } : {}),
            ...(args.content !== undefined ? { content: args.content } : {}),
            ...(transcriptIds !== undefined
              ? {
                  sourceType: transcriptIds.length > 0 ? ('TRANSCRIPT' as const) : null,
                  sourceId: transcriptIds[0] ?? null,
                }
              : {}),
          },
          ...(transcriptIds !== undefined
            ? {
                mutateRelations: async (tx) => {
                  await tx.note.update({
                    where: { id: existing.id },
                    data: {
                      transcriptSources:
                        args.source_anchors !== undefined
                          ? {
                              deleteMany: {},
                              ...(transcriptIds.length > 0
                                ? { create: noteSourceCreateData(userId, transcriptIds, anchors) }
                                : {}),
                            }
                          : {
                              deleteMany:
                                transcriptIds.length > 0
                                  ? { transcriptId: { notIn: transcriptIds } }
                                  : {},
                              upsert: transcriptIds.map((transcriptId) => ({
                                where: {
                                  noteId_transcriptId: { noteId: existing.id, transcriptId },
                                },
                                update: {},
                                create: { transcriptId, userId },
                              })),
                            },
                    },
                  });
                },
              }
            : {}),
        });
        const graphSync = await syncNoteGraph(userId, note.id);
        return ok({
          id: note.id,
          title: note.title,
          revision: note.revision,
          checksum: note.checksum,
          graphSync,
        });
      } catch (error) {
        const failure = noteWriteFailure(error);
        if (failure) return failure;
        throw error;
      }
    },
  );

  server.registerTool(
    'voxen_request_transcription',
    {
      title: 'Solicitar transcrição',
      description:
        'Enfileira a transcrição/indexação de uma URL (vídeo YouTube/Instagram/TikTok/X ou ' +
        'página web). Retorna um job_id; acompanhe com voxen_get_job_status(job_id) até ' +
        'status=DONE para receber um brief com resumo, tags e relacionados. Se a URL já foi ' +
        'transcrita, devolve o brief imediatamente. Leia o documento completo só como último recurso.',
      inputSchema: {
        url: z.string().min(1).max(2048).describe('URL do vídeo ou página a transcrever/indexar.'),
      },
      outputSchema: {
        outcome: z.string(),
        jobId: z.string().nullable(),
        transcriptId: z.string().nullable(),
        message: z.string(),
        brief: TRANSCRIPT_BRIEF_SCHEMA.nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        title: 'Solicitar transcrição',
      },
    },
    async (args) => {
      const result = await createAutoJobForUser(userId, args.url);
      switch (result.outcome) {
        case 'created':
          return ok({
            outcome: 'created',
            jobId: result.jobId,
            transcriptId: null,
            message: 'Job enfileirado. Use voxen_get_job_status(job_id) até status=DONE.',
            brief: null,
          });
        case 'existing_transcript':
          return ok({
            outcome: 'existing_transcript',
            jobId: null,
            transcriptId: result.transcriptId,
            message: 'URL já transcrita. Use o brief e leia trechos só se necessário.',
            brief: await getTranscriptBrief(userId, result.transcriptId),
          });
        case 'inflight':
          return ok({
            outcome: 'inflight',
            jobId: result.jobId ?? null,
            transcriptId: null,
            message: 'URL já está sendo processada. Acompanhe com voxen_get_job_status.',
            brief: null,
          });
        default:
          return fail(result.error);
      }
    },
  );

  server.registerTool(
    'voxen_request_transcriptions',
    {
      title: 'Solicitar várias transcrições',
      description:
        'Enfileira de 1 a 20 URLs de uma só vez. Cada entrada tem resultado e job independentes; ' +
        'uma URL inválida ou já existente não desfaz as demais.',
      inputSchema: {
        urls: z
          .array(z.string().min(1).max(2048))
          .min(1)
          .max(20)
          .describe('URLs de vídeos, posts ou páginas a transcrever/indexar.'),
      },
      outputSchema: {
        total: z.number(),
        created: z.number(),
        items: z.array(
          z.object({
            index: z.number(),
            url: z.string(),
            outcome: z.string(),
            jobId: z.string().nullable(),
            transcriptId: z.string().nullable(),
            error: z.string().nullable(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        title: 'Solicitar várias transcrições',
      },
    },
    async (args) => {
      const items = await createAutoJobsForUser(userId, args.urls);
      return ok({
        total: items.length,
        created: items.filter((item) => item.result.outcome === 'created').length,
        items: items.map((item) => ({
          index: item.index,
          url: item.input,
          outcome: item.result.outcome,
          jobId: 'jobId' in item.result ? (item.result.jobId ?? null) : null,
          transcriptId: 'transcriptId' in item.result ? (item.result.transcriptId ?? null) : null,
          error: 'error' in item.result ? item.result.error : null,
        })),
      });
    },
  );

  server.registerTool(
    'voxen_get_job_status',
    {
      title: 'Status de um job',
      description:
        'Consulta o status de um job de transcrição/indexação: QUEUED, RUNNING, DONE, FAILED ' +
        'ou CANCELLED. Quando DONE, retorna transcript_id e um brief read-only com resumo, tags e ' +
        'relacionados já armazenados; quando FAILED, retorna o erro.',
      inputSchema: {
        job_id: z.string().min(1).describe('ID do job retornado por request_transcription.'),
      },
      outputSchema: {
        id: z.string(),
        status: z.string(),
        transcriptId: z.string().nullable(),
        error: z.string().nullable(),
        brief: TRANSCRIPT_BRIEF_SCHEMA.nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Status de um job',
      },
    },
    async (args) => {
      const job = await db.job.findFirst({
        where: { id: args.job_id.trim(), userId },
        select: { id: true, status: true, transcriptId: true, errorMsg: true },
      });
      if (!job) return fail('Job não encontrado.');
      const brief =
        (job.status === 'DONE' || job.status === 'COMPLETED_WITH_WARNINGS') && job.transcriptId
          ? await getTranscriptBrief(userId, job.transcriptId, { enrichMissing: false })
          : null;
      return ok({
        id: job.id,
        status: job.status,
        transcriptId: job.transcriptId ?? null,
        error: job.errorMsg ?? null,
        brief,
      });
    },
  );
}

async function resolveMcpTranscriptSourceIds(
  userId: string,
  sourceIds: readonly string[],
): Promise<string[] | null> {
  const normalized = sourceIds.map((id) => id.trim());
  if (normalized.some((id) => !id)) return null;
  const ids = [...new Set(normalized)];
  if (ids.length === 0) return [];
  const transcripts = await db.transcript.findMany({
    where: { id: { in: ids }, userId, status: { not: 'TRASH' } },
    select: { id: true },
  });
  return transcripts.length === ids.length ? ids : null;
}
