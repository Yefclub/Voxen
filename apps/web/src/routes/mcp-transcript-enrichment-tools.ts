import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TranscriptEnrichment } from '../../prisma-generated/client';
import { db } from '../lib/db';
import { enrichmentContract, type EnrichmentParent } from '../lib/enrichment-contract';
import { EnrichmentCommandError, mutateEnrichment } from '../lib/enrichment-commands';
import {
  enqueueKnowledgeDeletion,
  KnowledgeDeletionConflictError,
  KnowledgeDeletionNotFoundError,
} from '../lib/knowledge-deletion';
import {
  getTranscriptEnrichmentStaleReason,
  normalizeTranscriptEnrichmentCitations,
  queueTranscriptResearch,
  TranscriptResearchQueueError,
} from '../lib/transcript-enrichments';
import { bounded, fail, ok, READ_ONLY, toMcpContentUrl } from './mcp-tool-helpers';

export function registerTranscriptEnrichmentTools(
  server: McpServer,
  userId: string,
  publicOrigin: string,
): void {
  server.registerTool(
    'voxen_list_transcript_enrichments',
    {
      title: 'Listar contexto adicional',
      description:
        'Lista pesquisas externas revisáveis de uma transcrição. Conteúdo sugerido ainda não ' +
        'foi aceito como contexto factual da Base de conhecimento.',
      inputSchema: {
        transcript_id: z.string().min(1),
        limit: z.number().int().min(1).max(30).optional(),
      },
      annotations: { ...READ_ONLY, title: 'Listar contexto adicional' },
    },
    async (args) => {
      const transcript = await db.transcript.findFirst({
        where: { id: args.transcript_id, userId, status: { not: 'TRASH' } },
        select: { id: true, sourceVersion: true, sourceChecksum: true, status: true },
      });
      if (!transcript) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      const enrichments = await db.transcriptEnrichment.findMany({
        where: { userId, transcriptId: transcript.id },
        orderBy: { createdAt: 'desc' },
        take: bounded(args.limit, 20, 1, 30),
      });
      return ok({
        enrichments: enrichments.map((item) =>
          serializeTranscriptEnrichment(
            { ...item, staleReason: getTranscriptEnrichmentStaleReason(item, transcript) },
            publicOrigin,
            transcript,
          ),
        ),
      });
    },
  );

  server.registerTool(
    'voxen_read_transcript_enrichment',
    {
      title: 'Ler contexto adicional',
      description:
        'Lê uma pesquisa externa com citações, estado de revisão, consultas e proveniência.',
      inputSchema: { enrichment_id: z.string().min(1) },
      annotations: { ...READ_ONLY, title: 'Ler contexto adicional' },
    },
    async (args) => {
      const enrichment = await db.transcriptEnrichment.findFirst({
        where: { id: args.enrichment_id, userId, transcript: { userId, status: { not: 'TRASH' } } },
        include: {
          transcript: { select: { sourceVersion: true, sourceChecksum: true, status: true } },
        },
      });
      if (!enrichment) return fail('Contexto adicional não encontrado.');
      const staleReason = getTranscriptEnrichmentStaleReason(enrichment, enrichment.transcript);
      const current = { ...enrichment, staleReason };
      return ok({
        enrichment: serializeTranscriptEnrichment(current, publicOrigin, enrichment.transcript),
      });
    },
  );
}

export function registerTranscriptEnrichmentWriteTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_request_transcript_research',
    {
      title: 'Solicitar pesquisa de contexto',
      description:
        'Enfileira pesquisa web limitada para uma transcrição. Gera uma sugestão citada e ' +
        'nunca aceita nem altera o resumo automaticamente.',
      inputSchema: { transcript_id: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        title: 'Solicitar pesquisa de contexto',
      },
    },
    async (args) => {
      try {
        const enrichment = await queueTranscriptResearch({
          userId,
          transcriptId: args.transcript_id,
          trigger: 'MCP',
        });
        return ok({
          id: enrichment.id,
          transcriptId: enrichment.transcriptId,
          status: enrichment.status,
          reviewState: enrichment.reviewState,
        });
      } catch (error) {
        if (error instanceof TranscriptResearchQueueError) return fail(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    'voxen_review_transcript_enrichment',
    {
      title: 'Revisar contexto adicional',
      description:
        'Aceita ou dispensa uma pesquisa externa. Aceitar inclui o contexto citado na busca e ' +
        'no Brain; dispensar remove somente seus derivados. Leia primeiro e envie expected_revision e expected_checksum; conflitos exigem nova leitura.',
      inputSchema: {
        enrichment_id: z.string().min(1),
        expected_revision: z.number().int().min(1),
        expected_checksum: z.string().regex(/^[a-f0-9]{64}$/),
        action: z.enum(['accept', 'dismiss', 'cancel']),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Revisar contexto adicional',
      },
    },
    async (args) => {
      try {
        const { enrichment: updated, parent } = await mutateEnrichment({
          userId,
          enrichmentId: args.enrichment_id,
          action: args.action,
          expectedRevision: args.expected_revision,
          expectedChecksum: args.expected_checksum,
        });
        return ok({
          id: updated.id,
          status: updated.status,
          reviewState: updated.reviewState,
          cancelRequested: Boolean(updated.cancelRequestedAt),
          ...enrichmentContract(updated, parent),
        });
      } catch (error) {
        if (error instanceof EnrichmentCommandError) return fail(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    'voxen_edit_transcript_enrichment',
    {
      title: 'Editar contexto adicional',
      description:
        'Edita título e Markdown, preservando citações. Leia primeiro e envie expected_revision e expected_checksum; conflitos exigem nova leitura.',
      inputSchema: {
        enrichment_id: z.string().min(1),
        expected_revision: z.number().int().min(1),
        expected_checksum: z.string().regex(/^[a-f0-9]{64}$/),
        title: z.string().trim().min(1).max(300),
        content: z.string().trim().min(1).max(200_000),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Editar contexto adicional',
      },
    },
    async (args) => {
      try {
        const { enrichment: updated, parent } = await mutateEnrichment({
          userId,
          enrichmentId: args.enrichment_id,
          action: 'edit',
          title: args.title,
          content: args.content,
          expectedRevision: args.expected_revision,
          expectedChecksum: args.expected_checksum,
        });
        return ok({
          id: updated.id,
          title: updated.title,
          reviewState: updated.reviewState,
          ...enrichmentContract(updated, parent),
        });
      } catch (error) {
        if (error instanceof EnrichmentCommandError) return fail(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    'voxen_delete_transcript_enrichment',
    {
      title: 'Excluir contexto adicional',
      description:
        'Enfileira a exclusão permanente de uma pesquisa e de seus derivados no grafo. ' +
        'Leia o contexto imediatamente antes e confirme o título exato.',
      inputSchema: {
        enrichment_id: z.string().min(1),
        expected_title: z.string().trim().min(1).max(300),
        confirm: z.literal(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Excluir contexto adicional',
      },
    },
    async (args) => {
      try {
        const result = await enqueueKnowledgeDeletion({
          userId,
          type: 'TRANSCRIPT_ENRICHMENT',
          id: args.enrichment_id,
          expectedTitle: args.expected_title,
        });
        return ok({
          id: result.target.id,
          title: result.target.title,
          jobId: result.job.id,
          status: result.job.status,
          queued: true,
          reused: !result.created,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeDeletionConflictError ||
          error instanceof KnowledgeDeletionNotFoundError
        ) {
          return fail(error.message);
        }
        throw error;
      }
    },
  );
}

function serializeTranscriptEnrichment(
  item: TranscriptEnrichment,
  publicOrigin: string,
  parent: EnrichmentParent,
): Record<string, unknown> {
  return {
    ...enrichmentContract(item, parent),
    id: item.id,
    transcriptId: item.transcriptId,
    type: item.type,
    status: item.status,
    reviewState: item.reviewState,
    trigger: item.trigger,
    title: item.title,
    content: item.content,
    citations: normalizeTranscriptEnrichmentCitations(item.citations),
    queries: Array.isArray(item.queries)
      ? item.queries.filter((query): query is string => typeof query === 'string').slice(0, 5)
      : [],
    rationale: item.rationale,
    noResearchReason: item.noResearchReason,
    sourceVersion: item.sourceVersion,
    sourceChecksum: item.sourceChecksum,
    model: item.model,
    costUsd: item.costUsd?.toString() ?? null,
    staleReason: item.staleReason,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    href: toMcpContentUrl(
      publicOrigin,
      `/transcricoes/${item.transcriptId}#additional-context-${item.id}`,
    ),
  };
}
