import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from './db';
import {
  commitTranscriptCorrection,
  commitTranscriptCorrectionSnapshot,
  loadTranscriptCorrectionHead,
  TranscriptCorrectionConflictError,
  TranscriptCorrectionNotFoundError,
} from './transcript-correction-versioning';
import {
  applyTranscriptPatch,
  transcriptCorrectionChecksum,
  transcriptMarkdownToPlainText,
} from './transcript-corrections';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('versioned transcript correction commits', () => {
  let userId = '';
  let foreignUserId = '';
  let transcriptId = '';
  const baseMarkdown = '# Transcript\n\n[00:00:01] wrong word';
  const canonicalPlainText = 'wrong word';
  const baseChecksum = transcriptCorrectionChecksum(
    baseMarkdown,
    transcriptMarkdownToPlainText(baseMarkdown),
  );

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `correction-owner-${suffix}@voxen.local`,
          name: 'Owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `correction-foreign-${suffix}@voxen.local`,
          name: 'Foreign',
          status: 'APPROVED',
        },
      }),
    ]);
    userId = owner.id;
    foreignUserId = foreign.id;
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'YOUTUBE',
        url: 'https://example.test/video',
        title: 'Immutable source',
        durationSec: 3,
        language: 'pt',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `tests/${suffix}.md`,
        plainText: canonicalPlainText,
        frontmatter: {},
      },
    });
    transcriptId = transcript.id;
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (foreignUserId)
      await db.user.delete({ where: { id: foreignUserId } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('one concurrent writer commits while canonical evidence stays immutable', async () => {
    const operations = [
      { kind: 'replace' as const, target: 'wrong word', text: 'correct A' },
      { kind: 'replace' as const, target: 'wrong word', text: 'correct B' },
    ];
    const writes = await Promise.allSettled(
      operations.map((operation) => {
        const markdown = applyTranscriptPatch(baseMarkdown, operation).content;
        const plainText = transcriptMarkdownToPlainText(markdown);
        return commitTranscriptCorrection({
          userId,
          transcriptId,
          expectedRevision: 0,
          expectedSourceVersion: 0,
          expectedSourceChecksum: null,
          expectedBaseChecksum: baseChecksum,
          expectedResultChecksum: transcriptCorrectionChecksum(markdown, plainText),
          baseMarkdown,
          operation,
          actor: 'USER',
          changeSummary: 'Concurrent correction',
        });
      }),
    );
    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = writes.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(TranscriptCorrectionConflictError);
    }
    const transcript = await db.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(transcript.plainText).toBe(canonicalPlainText);
    expect(transcript.mdPath).toContain('tests/');
    expect(transcript.correctionRevision).toBe(1);
    expect(transcript.correctedPlainText).toMatch(/correct [AB]/);
    expect(await db.transcriptCorrectionRevision.count({ where: { transcriptId } })).toBe(1);
  });

  test('a foreign owner cannot discover or mutate the correction head', async () => {
    const operation = { kind: 'append' as const, text: '\nforeign' };
    const markdown = applyTranscriptPatch(baseMarkdown, operation).content;
    await expect(
      commitTranscriptCorrection({
        userId: foreignUserId,
        transcriptId,
        expectedRevision: 1,
        expectedSourceVersion: 0,
        expectedSourceChecksum: null,
        expectedBaseChecksum: baseChecksum,
        expectedResultChecksum: transcriptCorrectionChecksum(
          markdown,
          transcriptMarkdownToPlainText(markdown),
        ),
        baseMarkdown,
        operation,
        actor: 'MCP',
        changeSummary: 'Forbidden',
      }),
    ).rejects.toBeInstanceOf(TranscriptCorrectionNotFoundError);
  });

  test('restore and reset create new immutable revisions without touching canonical evidence', async () => {
    const head = await loadTranscriptCorrectionHead(userId, transcriptId);
    const appended = applyTranscriptPatch(head.markdown, {
      kind: 'append',
      text: '\n[00:00:02] reviewed',
    }).content;
    const appendedPlain = transcriptMarkdownToPlainText(appended);
    const revisionTwo = await commitTranscriptCorrection({
      userId,
      transcriptId,
      expectedRevision: head.correctionRevision,
      expectedSourceVersion: head.sourceVersion,
      expectedSourceChecksum: head.sourceChecksum,
      expectedBaseChecksum: head.checksum,
      expectedResultChecksum: transcriptCorrectionChecksum(appended, appendedPlain),
      baseMarkdown: head.markdown,
      operation: { kind: 'append', text: '\n[00:00:02] reviewed' },
      actor: 'USER',
      changeSummary: 'Append reviewed passage',
    });
    expect(revisionTwo.revision).toBe(2);

    const first = await db.transcriptCorrectionRevision.findFirstOrThrow({
      where: { transcriptId, revision: 1, userId },
    });
    const restored = await commitTranscriptCorrectionSnapshot({
      userId,
      transcriptId,
      expectedRevision: revisionTwo.revision,
      expectedSourceVersion: revisionTwo.sourceVersion,
      expectedSourceChecksum: revisionTwo.sourceChecksum,
      expectedBaseChecksum: revisionTwo.checksum,
      expectedResultChecksum: first.checksum,
      baseMarkdown: revisionTwo.markdown,
      replacementMarkdown: first.markdown,
      operationMetadata: { kind: 'restore', revision: 1 },
      actor: 'RESTORE',
      changeSummary: 'Restore revision 1',
    });
    expect(restored.revision).toBe(3);
    expect(restored.markdown).toBe(first.markdown);

    const canonicalPlain = transcriptMarkdownToPlainText(baseMarkdown);
    const reset = await commitTranscriptCorrectionSnapshot({
      userId,
      transcriptId,
      expectedRevision: restored.revision,
      expectedSourceVersion: restored.sourceVersion,
      expectedSourceChecksum: restored.sourceChecksum,
      expectedBaseChecksum: restored.checksum,
      expectedResultChecksum: transcriptCorrectionChecksum(baseMarkdown, canonicalPlain),
      baseMarkdown: restored.markdown,
      replacementMarkdown: baseMarkdown,
      operationMetadata: { kind: 'reset_to_canonical' },
      actor: 'RESTORE',
      changeSummary: 'Reset corrections to canonical source',
    });
    expect(reset.revision).toBe(4);
    expect(reset.markdown).toBe(baseMarkdown);
    expect(await db.transcriptCorrectionRevision.count({ where: { transcriptId } })).toBe(4);

    const transcript = await db.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(transcript.plainText).toBe(canonicalPlainText);
    expect(transcript.mdPath).toContain('tests/');
  });

  test('resetting a stale overlay records a new canonical head revision', async () => {
    await db.transcript.update({
      where: { id: transcriptId },
      data: {
        correctionState: 'STALE',
        correctionStaleReason: 'source-version-changed',
      },
    });
    const current = await db.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    const canonicalPlain = transcriptMarkdownToPlainText(baseMarkdown);
    const canonicalChecksum = transcriptCorrectionChecksum(baseMarkdown, canonicalPlain);
    const reset = await commitTranscriptCorrectionSnapshot({
      userId,
      transcriptId,
      expectedRevision: current.correctionRevision,
      expectedSourceVersion: current.sourceVersion,
      expectedSourceChecksum: current.sourceChecksum,
      expectedBaseChecksum: canonicalChecksum,
      expectedResultChecksum: canonicalChecksum,
      baseMarkdown,
      replacementMarkdown: baseMarkdown,
      allowUnchangedReplacement: true,
      operationMetadata: { kind: 'reset_to_canonical' },
      actor: 'RESTORE',
      changeSummary: 'Reset stale correction to canonical source',
    });
    expect(reset.revision).toBe(5);
    expect(reset.state).toBe('ACTIVE');
    expect(reset.markdown).toBe(baseMarkdown);
    expect(await db.transcriptCorrectionRevision.count({ where: { transcriptId } })).toBe(5);
    expect((await db.transcript.findUniqueOrThrow({ where: { id: transcriptId } })).plainText).toBe(
      canonicalPlainText,
    );
  });
});
