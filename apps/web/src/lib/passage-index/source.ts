import { createHash } from 'node:crypto';
import { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { storageReadText } from '../storage';
import { organizationEvidenceSpans } from '../organization/provenance';
import { sourceEvidenceStamp, SourceProvenanceError } from '../source-provenance';
import { PassageBuildError, type PassageRegion, type PassageSource } from './build';

export type PassageIdentity = Pick<PassageSource, 'userId' | 'type' | 'id'>;
export class PassageSourceError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'UNAVAILABLE_SOURCE' | 'STALE_REVISION') {
    super(code);
    this.name = 'PassageSourceError';
  }
}
const transcriptSelect = {
  id: true,
  userId: true,
  title: true,
  mdPath: true,
  sourceVersion: true,
  sourceChecksum: true,
  sourceMetadata: true,
  correctionRevision: true,
  correctionState: true,
  correctedChecksum: true,
  correctedMarkdown: true,
} as const satisfies Prisma.TranscriptSelect;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Locks canonical rows before the derived ledger, matching source-write triggers. */
export async function readPassageRecord(
  identity: PassageIdentity,
  client: Prisma.TransactionClient = db,
  lock = false,
) {
  const { userId, type, id } = identity;
  if (lock) {
    if (type === 'external_enrichment') {
      await client.$queryRaw`
        SELECT t.id FROM "Transcript" t JOIN "TranscriptEnrichment" e ON e."transcriptId" = t.id
        WHERE e.id = ${id} AND e."userId" = ${userId} AND t."userId" = ${userId}
        FOR UPDATE OF t
      `;
    }
    const table =
      type === 'transcript' ? 'Transcript' : type === 'note' ? 'Note' : 'TranscriptEnrichment';
    await client.$queryRaw(Prisma.sql`
      SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE
    `);
  }
  const owner = { userId, user: { status: 'APPROVED' as const } };
  if (type === 'transcript') {
    const data = await client.transcript.findFirst({
      where: { id, ...owner, status: 'ACTIVE' },
      select: transcriptSelect,
    });
    if (!data) throw new PassageSourceError('NOT_FOUND');
    return { type, data, revision: digest(data) } as const;
  }
  if (type === 'note') {
    const data = await client.note.findFirst({
      where: { id, ...owner, kind: 'NOTE' },
      select: { id: true, userId: true, title: true, content: true, revision: true },
    });
    if (!data) throw new PassageSourceError('NOT_FOUND');
    return { type, data, revision: digest(data) } as const;
  }
  const data = await client.transcriptEnrichment.findFirst({
    where: {
      id,
      ...owner,
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      transcript: { userId, status: 'ACTIVE' },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      content: true,
      revision: true,
      transcriptId: true,
      sourceVersion: true,
      sourceChecksum: true,
      expiresAt: true,
      transcript: { select: { sourceVersion: true, sourceChecksum: true } },
    },
  });
  if (
    !data ||
    data.sourceVersion !== data.transcript.sourceVersion ||
    data.sourceChecksum !== data.transcript.sourceChecksum
  )
    throw new PassageSourceError('NOT_FOUND');
  return { type: 'external_enrichment', data, revision: digest(data) } as const;
}

/** No headings or generated prose can confer captured-source authority. */
function transcriptRegions(
  data: Prisma.TranscriptGetPayload<{ select: typeof transcriptSelect }>,
  canonical: string,
  markdown: string,
): { regions: PassageRegion[]; limitations: string[] } {
  const derived: PassageRegion[] = markdown.length
    ? [{ start: 0, end: markdown.length, kind: 'SOURCE_DERIVED', authority: null }]
    : [];
  if (!sourceEvidenceStamp(data.sourceMetadata).captured)
    return { regions: derived, limitations: ['PROVENANCE_UNAVAILABLE'] };
  let spans;
  try {
    spans = organizationEvidenceSpans({ ...data, canonicalMarkdown: canonical, markdown });
  } catch (error) {
    if (error instanceof SourceProvenanceError)
      return { regions: derived, limitations: ['PROVENANCE_UNAVAILABLE'] };
    throw error;
  }
  const regions: PassageRegion[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (cursor < span.start)
      regions.push({ start: cursor, end: span.start, kind: 'SOURCE_DERIVED', authority: null });
    regions.push({ start: span.start, end: span.end, kind: 'ORIGINAL', authority: span.authority });
    cursor = span.end;
  }
  if (cursor < markdown.length)
    regions.push({ start: cursor, end: markdown.length, kind: 'SOURCE_DERIVED', authority: null });
  return { regions, limitations: [] };
}

/** Object I/O is outside publication transactions; the worker rechecks this revision. */
export async function loadPassageSource(identity: PassageIdentity) {
  const record = await readPassageRecord(identity);
  let text: string,
    regions: PassageRegion[],
    limitations: string[] = [];
  if (record.type === 'transcript') {
    let canonical: string;
    try {
      canonical = await storageReadText(record.data.mdPath);
    } catch {
      throw new PassageSourceError('UNAVAILABLE_SOURCE');
    }
    if (!canonical) throw new PassageSourceError('UNAVAILABLE_SOURCE');
    text =
      record.data.correctionState === 'ACTIVE' && record.data.correctedMarkdown !== null
        ? record.data.correctedMarkdown
        : canonical;
    if (text.length > 4_000_000 || canonical.length > 4_000_000)
      throw new PassageBuildError('INDEX_CAPACITY');
    ({ regions, limitations } = transcriptRegions(record.data, canonical, text));
  } else {
    text = record.data.content;
    regions = text.length
      ? [
          {
            start: 0,
            end: text.length,
            authority: null,
            kind: record.type === 'note' ? 'ORIGINAL' : 'EXTERNAL_ACCEPTED',
          },
        ]
      : [];
  }
  return {
    source: {
      ...identity,
      revision: record.revision,
      title: record.data.title,
      text,
      regions,
    } satisfies PassageSource,
    limitations,
  };
}
