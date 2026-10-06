import { z } from 'zod';
import { db } from './db';
import { enrichmentChecksum, type EnrichmentParent } from './enrichment-contract';
import {
  getTranscriptEnrichmentStaleReason,
  normalizeTranscriptEnrichmentCitations,
} from './transcript-enrichments';

export class EnrichmentCommandError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'NOT_READY'
      | 'STALE'
      | 'CITATIONS'
      | 'INACTIVE'
      | 'COMPLETED',
    public readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}
export type EnrichmentCommand = {
  userId: string;
  enrichmentId: string;
  transcriptId?: string;
  expectedRevision: number;
  expectedChecksum: string;
} & (
  | { action: 'accept' | 'dismiss' | 'cancel' }
  | { action: 'edit'; title: string; content: string }
);

const UsableCitations = z
  .array(
    z.object({
      url: z
        .string()
        .url()
        .max(2048)
        .refine((value) => /^https?:\/\//i.test(value)),
      title: z.string().trim().min(1).max(500),
      excerpt: z.string().trim().min(1).max(4000),
      start: z.number().int().min(0).optional(),
      end: z.number().int().min(0).optional(),
    }),
  )
  .min(1)
  .max(12);

/** Lock the parent before the child, then validate the exact observed canonical snapshot. */
export async function mutateEnrichment(input: EnrichmentCommand) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
      const found = await tx.transcriptEnrichment.findFirst({
        where: {
          id: input.enrichmentId,
          userId: input.userId,
          ...(input.transcriptId ? { transcriptId: input.transcriptId } : {}),
        },
        select: { transcriptId: true },
      });
      if (!found)
        throw new EnrichmentCommandError('NOT_FOUND', 404, 'Contexto adicional não encontrado.');
      const parents = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "Transcript" WHERE id = ${found.transcriptId} AND "userId" = ${input.userId} FOR SHARE`;
      if (!parents.length)
        throw new EnrichmentCommandError('NOT_FOUND', 404, 'Contexto adicional não encontrado.');
      await tx.$queryRaw`SELECT id FROM "TranscriptEnrichment" WHERE id = ${input.enrichmentId} AND "userId" = ${input.userId} FOR UPDATE`;
      const row = await tx.transcriptEnrichment.findFirst({
        where: { id: input.enrichmentId, userId: input.userId, transcriptId: found.transcriptId },
      });
      const parent = await tx.transcript.findFirst({
        where: { id: found.transcriptId, userId: input.userId },
        select: { sourceVersion: true, sourceChecksum: true, status: true },
      });
      if (!row || !parent)
        throw new EnrichmentCommandError('NOT_FOUND', 404, 'Contexto adicional não encontrado.');
      if (
        row.revision !== input.expectedRevision ||
        enrichmentChecksum(row, parent) !== input.expectedChecksum
      )
        throw new EnrichmentCommandError(
          'CONFLICT',
          409,
          'O contexto mudou. Leia a versão atual antes de tentar novamente.',
        );
      const now = new Date();
      if (input.action === 'cancel') {
        if (!['PENDING', 'RUNNING', 'RETRY'].includes(row.status))
          throw new EnrichmentCommandError('COMPLETED', 409, 'A execução já foi concluída.');
        if (row.cancelRequestedAt) return { enrichment: row, parent: parent as EnrichmentParent };
      } else if (input.action === 'accept' || input.action === 'edit') {
        if (
          (input.action === 'accept' && parent.status !== 'ACTIVE') ||
          (input.action === 'edit' && parent.status === 'TRASH')
        )
          throw new EnrichmentCommandError('INACTIVE', 409, 'A transcrição não está ativa.');
        if (row.status !== 'READY')
          throw new EnrichmentCommandError('NOT_READY', 409, 'O contexto ainda não está pronto.');
        if (input.action === 'accept') {
          if (getTranscriptEnrichmentStaleReason(row, parent))
            throw new EnrichmentCommandError('STALE', 409, 'O contexto está desatualizado.');
          const citations = normalizeTranscriptEnrichmentCitations(row.citations);
          if (
            !UsableCitations.safeParse(row.citations).success ||
            !Array.isArray(row.citations) ||
            !citations.length ||
            citations.length !== row.citations.length ||
            citations.length > 12
          )
            throw new EnrichmentCommandError(
              'CITATIONS',
              422,
              'O contexto não possui citações utilizáveis.',
            );
        }
        if (input.action === 'edit' && row.title === input.title && row.content === input.content)
          return { enrichment: row, parent: parent as EnrichmentParent };
      }
      if (
        (input.action === 'accept' && row.reviewState === 'ACCEPTED') ||
        (input.action === 'dismiss' && row.reviewState === 'DISMISSED')
      )
        return { enrichment: row, parent: parent as EnrichmentParent };
      const actionData =
        input.action === 'edit'
          ? { title: input.title, content: input.content, editedAt: now }
          : input.action === 'accept'
            ? { reviewState: 'ACCEPTED' as const, acceptedAt: now, dismissedAt: null }
            : input.action === 'dismiss'
              ? { reviewState: 'DISMISSED' as const, dismissedAt: now, acceptedAt: null }
              : { cancelRequestedAt: now };
      const enrichment = await tx.transcriptEnrichment.update({
        where: { id: row.id },
        data: {
          ...actionData,
          revision: { increment: 1 },
          brainProjectionPending: true,
          brainProjectionAttempt: 0,
          brainProjectionNextAttemptAt: null,
          brainProjectionErrorCode: null,
        },
      });
      return { enrichment, parent: parent as EnrichmentParent };
    },
    { maxWait: 2000, timeout: 5000 },
  );
}
