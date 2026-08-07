import { tool } from 'ai';
import { z } from 'zod';
import { db } from '../db';
import { normalizeTranscriptEnrichmentCitations } from '../transcript-enrichments';

export function createReadExternalEnrichmentTool(userId: string) {
  return tool({
    description:
      'Lê o conteúdo completo e as citações URL de um contexto externo revisado encontrado ' +
      'por search_knowledge. Só devolve itens aceitos, atuais e ligados a uma transcrição ativa.',
    inputSchema: z.object({ enrichmentId: z.string().min(1) }),
    execute: async ({ enrichmentId }) => {
      const enrichment = await db.transcriptEnrichment.findFirst({
        where: {
          id: enrichmentId,
          userId,
          status: 'READY',
          reviewState: 'ACCEPTED',
          staleReason: null,
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
          transcript: { status: 'ACTIVE' },
        },
        select: {
          id: true,
          transcriptId: true,
          title: true,
          content: true,
          citations: true,
          generatedAt: true,
          checkedAt: true,
        },
      });
      if (!enrichment) return { error: 'Contexto externo não encontrado ou indisponível.' };
      return {
        id: enrichment.id,
        transcriptId: enrichment.transcriptId,
        title: enrichment.title,
        content: enrichment.content,
        citations: normalizeTranscriptEnrichmentCitations(enrichment.citations),
        authority: 'external-derived' as const,
        generatedAt: enrichment.generatedAt?.toISOString() ?? null,
        checkedAt: enrichment.checkedAt?.toISOString() ?? null,
        href: `/transcricoes/${enrichment.transcriptId}#additional-context-${enrichment.id}`,
      };
    },
  });
}
