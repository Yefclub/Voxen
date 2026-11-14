import { z } from 'zod';
import { db } from '../db';
import { buildPassages, type Passage } from './build';
import {
  loadPassageSource,
  readPassageRecord,
  PassageSourceError,
  type PassageIdentity,
} from './source';

const referencePart = z.string().regex(/^[a-f0-9]{64}$/);

/** A search lead becomes verified text only after this canonical revision check. */
export async function readPassage(userId: string, key: string, revision: string) {
  referencePart.parse(key);
  referencePart.parse(revision);
  const row = await db.retrievalPassage.findFirst({
    where: { key, userId },
    include: { source: true },
  });
  if (!row) throw new PassageSourceError('NOT_FOUND');
  const identity = { userId, type: row.sourceType, id: row.sourceId } as PassageIdentity;
  const loaded = await loadPassageSource(identity),
    source = loaded.source;
  const current = () =>
    row.source.status === 'READY' &&
    row.source.generation === row.source.indexedGeneration &&
    row.source.revision === revision &&
    source.revision === revision;
  if (!current()) throw new PassageSourceError('STALE_REVISION');
  const built = buildPassages(source),
    passage = built.passages.find((p) => p.key === key);
  if (
    !passage ||
    row.source.checksum !== built.checksum ||
    row.source.snapshot !== built.snapshot ||
    (Object.keys(passage) as Array<keyof Passage>).some((field) => passage[field] !== row[field])
  )
    throw new PassageSourceError('STALE_REVISION');
  const record = await db.$transaction(
    async (tx) => {
      const record = await readPassageRecord(identity, tx);
      const head = await tx.passageIndexSource.findFirst({
        where: {
          userId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          status: 'READY',
          generation: row.source.generation,
          indexedGeneration: row.source.generation,
          revision,
        },
      });
      if (!head || record.revision !== revision) throw new PassageSourceError('STALE_REVISION');
      return record;
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return {
    key,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    title: source.title,
    href:
      record.type === 'transcript'
        ? `/transcricoes/${row.sourceId}`
        : record.type === 'note'
          ? `/notas/${row.sourceId}`
          : `/transcricoes/${record.data.transcriptId}#additional-context-${row.sourceId}`,
    revision,
    documentChecksum: row.source.checksum!,
    passageChecksum: row.checksum,
    text: passage.text,
    kind: passage.kind,
    authority: passage.authority,
    section: passage.section,
    startOffset: passage.startOffset,
    endOffset: passage.endOffset,
    startLine: passage.startLine,
    endLine: passage.endLine,
    startSec: passage.startSec,
    endSec: passage.endSec,
    limitations: loaded.limitations,
  };
}
