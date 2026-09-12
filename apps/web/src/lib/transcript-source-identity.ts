import type { Prisma } from '../../prisma-generated/client';

type TranscriptLookupClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Resolve an active knowledge item through every source identity persisted by
 * the ingestion worker. Short links remain useful aliases after the worker has
 * resolved and stored the canonical provider URL.
 */
export async function findTranscriptBySourceIdentity(
  client: TranscriptLookupClient,
  userId: string,
  sourceUrl: string,
): Promise<{ id: string } | null> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Transcript"
    WHERE "userId" = ${userId}
      AND status <> 'TRASH'::"ContentStatus"
      AND (
        url = ${sourceUrl}
        OR "sourceMetadata" ->> 'submittedUrl' = ${sourceUrl}
        OR "sourceMetadata" ->> 'canonicalUrl' = ${sourceUrl}
      )
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}
