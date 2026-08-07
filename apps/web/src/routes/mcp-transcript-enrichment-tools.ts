import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TranscriptEnrichment } from '../../prisma-generated/client';
import { db } from '../lib/db';
import { deleteBrainForSource } from '../lib/brain';
import { reindexTranscriptEnrichmentBrain } from '../lib/brain-enrichments';
import { invalidateGraphCache } from '../lib/graph-cache';
import {
  getTranscriptEnrichmentStaleReason,
  queueTranscriptResearch,
  refreshTranscriptEnrichmentFreshness,
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
        select: { id: true, sourceVersion: true, sourceChecksum: true },
      });
      if (!transcript) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      const staleAcceptedIds = await refreshTranscriptEnrichmentFreshness({
        userId,
        transcriptId: transcript.id,
        sourceVersion: transcript.sourceVersion,
        sourceChecksum: transcript.sourceChecksum,
      });
      await Promise.all(
        staleAcceptedIds.map((id) => deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', id)),
      );
      if (staleAcceptedIds.length > 0) await invalidateGraphCache(userId);
      const enrichments = await db.transcriptEnrichment.findMany({
        where: { userId, transcriptId: transcript.id },
        orderBy: { createdAt: 'desc' },
        take: bounded(args.limit, 20, 1, 30),
      });
      return ok({
        enrichments: enrichments.map((item) => serializeTranscriptEnrichment(item, publicOrigin)),
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
        where: { id: args.enrichment_id, userId },
        include: { transcript: { select: { sourceVersion: true, sourceChecksum: true } } },
      });
      if (!enrichment) return fail('Contexto adicional não encontrado.');
      const staleReason = getTranscriptEnrichmentStaleReason(enrichment, enrichment.transcript);
      const current = staleReason
        ? await db.transcriptEnrichment.update({
            where: { id: enrichment.id },
            data: { staleReason },
          })
        : enrichment;
      if (staleReason && enrichment.reviewState === 'ACCEPTED') {
        await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', enrichment.id);
        await invalidateGraphCache(userId);
      }
      return ok({ enrichment: serializeTranscriptEnrichment(current, publicOrigin) });
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
        'no Brain; dispensar remove somente seus derivados.',
      inputSchema: {
        enrichment_id: z.string().min(1),
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
      const existing = await db.transcriptEnrichment.findFirst({
        where: { id: args.enrichment_id, userId },
        include: { transcript: { select: { sourceVersion: true, sourceChecksum: true } } },
      });
      if (!existing) return fail('Contexto adicional não encontrado.');
      if (args.action === 'cancel') {
        if (!['PENDING', 'RUNNING', 'RETRY'].includes(existing.status)) {
          return fail('A execução já foi concluída.');
        }
        const updated = await db.transcriptEnrichment.update({
          where: { id: existing.id },
          data: { cancelRequestedAt: new Date() },
        });
        return ok({ id: updated.id, status: updated.status, cancelRequested: true });
      }
      if (args.action === 'accept') {
        if (existing.status !== 'READY') return fail('O contexto ainda não está pronto.');
        const staleReason = getTranscriptEnrichmentStaleReason(existing, existing.transcript);
        if (staleReason) {
          if (!existing.staleReason) {
            await db.transcriptEnrichment.update({
              where: { id: existing.id },
              data: { staleReason },
            });
          }
          return fail('O contexto está desatualizado.');
        }
        if (normalizeEnrichmentCitations(existing.citations).length === 0) {
          return fail('O contexto não possui citações utilizáveis.');
        }
        const updated = await db.transcriptEnrichment.update({
          where: { id: existing.id },
          data: { reviewState: 'ACCEPTED', acceptedAt: new Date(), dismissedAt: null },
        });
        await reindexTranscriptEnrichmentBrain(userId, updated.id);
        await invalidateGraphCache(userId);
        return ok({ id: updated.id, status: updated.status, reviewState: updated.reviewState });
      }
      const updated = await db.transcriptEnrichment.update({
        where: { id: existing.id },
        data: { reviewState: 'DISMISSED', dismissedAt: new Date(), acceptedAt: null },
      });
      await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', updated.id);
      await invalidateGraphCache(userId);
      return ok({ id: updated.id, status: updated.status, reviewState: updated.reviewState });
    },
  );

  server.registerTool(
    'voxen_edit_transcript_enrichment',
    {
      title: 'Editar contexto adicional',
      description: 'Edita título e Markdown, preservando as citações e a identidade externa.',
      inputSchema: {
        enrichment_id: z.string().min(1),
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
      const existing = await db.transcriptEnrichment.findFirst({
        where: { id: args.enrichment_id, userId, status: 'READY' },
      });
      if (!existing) return fail('Contexto adicional pronto não encontrado.');
      const updated = await db.transcriptEnrichment.update({
        where: { id: existing.id },
        data: { title: args.title, content: args.content, editedAt: new Date() },
      });
      if (updated.reviewState === 'ACCEPTED') {
        await reindexTranscriptEnrichmentBrain(userId, updated.id);
        await invalidateGraphCache(userId);
      }
      return ok({ id: updated.id, title: updated.title, reviewState: updated.reviewState });
    },
  );

  server.registerTool(
    'voxen_delete_transcript_enrichment',
    {
      title: 'Excluir contexto adicional',
      description: 'Exclui permanentemente uma pesquisa e somente seus derivados de busca e Brain.',
      inputSchema: { enrichment_id: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
        title: 'Excluir contexto adicional',
      },
    },
    async (args) => {
      const existing = await db.transcriptEnrichment.findFirst({
        where: { id: args.enrichment_id, userId },
        select: { id: true },
      });
      if (!existing) return fail('Contexto adicional não encontrado.');
      await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', existing.id);
      await db.transcriptEnrichment.delete({ where: { id: existing.id } });
      await invalidateGraphCache(userId);
      return ok({ id: existing.id, deleted: true });
    },
  );
}

function serializeTranscriptEnrichment(
  item: TranscriptEnrichment,
  publicOrigin: string,
): Record<string, unknown> {
  return {
    id: item.id,
    transcriptId: item.transcriptId,
    type: item.type,
    status: item.status,
    reviewState: item.reviewState,
    trigger: item.trigger,
    title: item.title,
    content: item.content,
    citations: normalizeEnrichmentCitations(item.citations),
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

function normalizeEnrichmentCitations(value: unknown): Array<{
  url: string;
  title: string;
  excerpt: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const citation = candidate as Record<string, unknown>;
    const url = typeof citation.url === 'string' ? citation.url : '';
    const title = typeof citation.title === 'string' ? citation.title : '';
    const excerpt = typeof citation.excerpt === 'string' ? citation.excerpt : '';
    try {
      const parsed = new URL(url);
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !title || !excerpt) {
        return [];
      }
      return [{ url, title, excerpt }];
    } catch {
      return [];
    }
  });
}
