import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import {
  loadPassageSource,
  readPassageRecord,
  PassageSourceError,
  type PassageIdentity,
} from './source';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
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
  const text = source.text.slice(row.startOffset, row.endOffset);
  if (
    row.source.checksum !== digest(source.text) ||
    text !== row.text ||
    digest(text) !== row.checksum ||
    key !== digest(`${row.source.snapshot}:${row.startOffset}:${row.endOffset}`)
  )
    throw new PassageSourceError('STALE_REVISION');
  await db.$transaction(
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
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return {
    key,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    title: source.title,
    revision,
    documentChecksum: row.source.checksum!,
    passageChecksum: row.checksum,
    text,
    kind: row.kind,
    authority: row.authority,
    section: row.section,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    startLine: row.startLine,
    endLine: row.endLine,
    startSec: row.startSec,
    endSec: row.endSec,
    limitations: loaded.limitations,
  };
}
