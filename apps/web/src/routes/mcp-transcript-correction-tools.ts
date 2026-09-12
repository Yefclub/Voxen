import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { summarizeNotePatch } from '../lib/note-revisions';
import {
  commitTranscriptCorrection,
  commitTranscriptCorrectionSnapshot,
  loadTranscriptCorrectionHead,
  syncTranscriptCorrectionGraph,
  TranscriptCorrectionConflictError,
  TranscriptCorrectionNotFoundError,
  type TranscriptCorrectionHead,
} from '../lib/transcript-correction-versioning';
import { TranscriptPatchOperationSchema } from '../lib/transcript-correction-schemas';
import {
  applyTranscriptPatch,
  searchWithinTranscript,
  transcriptCorrectionChecksum,
  transcriptMarkdownToPlainText,
} from '../lib/transcript-corrections';
import { db } from '../lib/db';
import { fail, ok } from './mcp-tool-helpers';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpTranscriptCorrectionReadTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_search_transcript_content',
    {
      title: 'Buscar dentro de uma transcrição',
      description: 'Localiza ocorrências no Markdown efetivo antes de uma correção cirúrgica.',
      inputSchema: {
        transcript_id: z.string().min(1),
        query: z.string().min(1).max(10_000),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { ...READ_ONLY, title: 'Buscar dentro da transcrição' },
    },
    async (args) => {
      try {
        const head = await loadTranscriptCorrectionHead(userId, args.transcript_id);
        return ok({
          ...headFields(head),
          matches: searchWithinTranscript(head.markdown, args.query, {
            limit: args.limit ?? 20,
            contextChars: 180,
          }),
        });
      } catch (error) {
        return correctionFailure(error);
      }
    },
  );

  server.registerTool(
    'voxen_list_transcript_corrections',
    {
      title: 'Listar revisões de correção',
      description: 'Lista o histórico imutável de correções.',
      inputSchema: {
        transcript_id: z.string().min(1),
        before_revision: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { ...READ_ONLY, title: 'Listar correções' },
    },
    async (args) => {
      const limit = args.limit ?? 50;
      const rows = await db.transcriptCorrectionRevision.findMany({
        where: {
          userId,
          transcriptId: args.transcript_id,
          ...(args.before_revision ? { revision: { lt: args.before_revision } } : {}),
        },
        orderBy: { revision: 'desc' },
        take: limit + 1,
        select: {
          revision: true,
          sourceVersion: true,
          sourceChecksum: true,
          checksum: true,
          actor: true,
          changeSummary: true,
          createdAt: true,
        },
      });
      const page = rows.slice(0, limit);
      return ok({
        revisions: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        nextBefore: rows.length > limit ? (page.at(-1)?.revision ?? null) : null,
      });
    },
  );

  server.registerTool(
    'voxen_read_transcript_correction',
    {
      title: 'Ler revisão de correção',
      description: 'Lê uma revisão imutável específica.',
      inputSchema: { transcript_id: z.string().min(1), revision: z.number().int().min(1) },
      annotations: { ...READ_ONLY, title: 'Ler correção' },
    },
    async (args) => {
      const revision = await db.transcriptCorrectionRevision.findFirst({
        where: { userId, transcriptId: args.transcript_id, revision: args.revision },
      });
      return revision
        ? ok({ ...revision, createdAt: revision.createdAt.toISOString() })
        : fail('Revisão não encontrada (ou fora do escopo do token).');
    },
  );
}

export function registerMcpTranscriptCorrectionWriteTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_patch_transcript',
    {
      title: 'Corrigir trecho de transcrição',
      description:
        'Pré-visualiza ou aplica uma correção exata na camada versionada sem alterar a fonte original.',
      inputSchema: {
        transcript_id: z.string().min(1),
        expected_revision: z.number().int().min(0),
        expected_source_version: z.number().int().min(0),
        expected_source_checksum: z.string().max(256).nullable(),
        expected_checksum: z.string().regex(/^[a-f0-9]{64}$/),
        expected_result_checksum: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        operation: TranscriptPatchOperationSchema,
        preview_only: z.boolean().optional().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        title: 'Corrigir transcrição',
      },
    },
    async (args) => {
      try {
        const head = await loadTranscriptCorrectionHead(userId, args.transcript_id);
        assertHead(head, args);
        const patched = applyTranscriptPatch(head.markdown, args.operation);
        const plainText = transcriptMarkdownToPlainText(patched.content);
        const resultChecksum = transcriptCorrectionChecksum(patched.content, plainText);
        const preview = {
          matchCount: patched.matchCount,
          line: patched.startLine,
          before: patched.before.slice(0, 1_000),
          after: patched.after.slice(0, 1_000),
          context: patched.content.slice(
            Math.max(0, patched.start - 200),
            Math.min(patched.content.length, patched.start + patched.after.length + 200),
          ),
        };
        if (args.preview_only !== false)
          return ok({ applied: false, resultChecksum, preview, ...headFields(head) });
        if (args.expected_result_checksum !== resultChecksum)
          return fail('O checksum do preview é obrigatório e não corresponde à correção atual.');
        const correction = await commitTranscriptCorrection({
          userId,
          transcriptId: head.id,
          expectedRevision: head.correctionRevision,
          expectedSourceVersion: head.sourceVersion,
          expectedSourceChecksum: head.sourceChecksum,
          expectedBaseChecksum: head.checksum,
          expectedResultChecksum: resultChecksum,
          baseMarkdown: head.markdown,
          operation: args.operation,
          actor: 'MCP',
          changeSummary: summarizeNotePatch(args.operation),
        });
        return ok({
          applied: true,
          correction,
          graphSync: await syncTranscriptCorrectionGraph(userId, head.id),
          preview,
        });
      } catch (error) {
        return correctionFailure(error);
      }
    },
  );

  server.registerTool(
    'voxen_restore_transcript_correction',
    {
      title: 'Restaurar correção de transcrição',
      description: 'Restaura uma revisão histórica criando uma nova cabeça.',
      inputSchema: {
        transcript_id: z.string().min(1),
        revision: z.number().int().min(1),
        expected_revision: z.number().int().min(0),
        expected_source_version: z.number().int().min(0),
        expected_source_checksum: z.string().max(256).nullable(),
        expected_checksum: z.string().regex(/^[a-f0-9]{64}$/),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
        title: 'Restaurar correção',
      },
    },
    async (args) => {
      try {
        const [head, snapshot] = await Promise.all([
          loadTranscriptCorrectionHead(userId, args.transcript_id),
          db.transcriptCorrectionRevision.findFirst({
            where: { userId, transcriptId: args.transcript_id, revision: args.revision },
          }),
        ]);
        if (!snapshot) return fail('Revisão não encontrada (ou fora do escopo do token).');
        assertHead(head, args);
        if (
          snapshot.sourceVersion !== head.sourceVersion ||
          snapshot.sourceChecksum !== head.sourceChecksum
        )
          return fail('A revisão pertence a outra versão da fonte.');
        const correction = await commitTranscriptCorrectionSnapshot({
          userId,
          transcriptId: head.id,
          expectedRevision: head.correctionRevision,
          expectedSourceVersion: head.sourceVersion,
          expectedSourceChecksum: head.sourceChecksum,
          expectedBaseChecksum: head.checksum,
          expectedResultChecksum: snapshot.checksum,
          baseMarkdown: head.markdown,
          replacementMarkdown: snapshot.markdown,
          operationMetadata: { kind: 'restore', revision: args.revision },
          actor: 'RESTORE',
          changeSummary: `Restore correction revision ${args.revision} through MCP`,
        });
        return ok({
          correction,
          restoredFromRevision: args.revision,
          graphSync: await syncTranscriptCorrectionGraph(userId, head.id),
        });
      } catch (error) {
        return correctionFailure(error);
      }
    },
  );
}

function assertHead(
  head: TranscriptCorrectionHead,
  input: {
    expected_revision: number;
    expected_source_version: number;
    expected_source_checksum: string | null;
    expected_checksum: string;
  },
): void {
  if (
    head.correctionRevision !== input.expected_revision ||
    head.sourceVersion !== input.expected_source_version ||
    head.sourceChecksum !== input.expected_source_checksum ||
    head.checksum !== input.expected_checksum
  )
    throw new TranscriptCorrectionConflictError({
      currentRevision: head.correctionRevision,
      currentChecksum: head.checksum,
      sourceVersion: head.sourceVersion,
      sourceChecksum: head.sourceChecksum,
    });
}
function headFields(head: TranscriptCorrectionHead): object {
  return {
    transcriptId: head.id,
    revision: head.correctionRevision,
    checksum: head.checksum,
    sourceVersion: head.sourceVersion,
    sourceChecksum: head.sourceChecksum,
  };
}
function correctionFailure(error: unknown): ReturnType<typeof fail> {
  if (error instanceof TranscriptCorrectionNotFoundError)
    return fail('Transcrição não encontrada (ou fora do escopo do token).');
  if (error instanceof TranscriptCorrectionConflictError)
    return fail(
      `Conflito: revisão atual ${error.currentRevision}, checksum ${error.currentChecksum}, fonte ${error.sourceVersion}/${error.sourceChecksum ?? 'null'}.`,
    );
  return fail(error instanceof Error ? error.message : 'Falha ao processar a correção.');
}
