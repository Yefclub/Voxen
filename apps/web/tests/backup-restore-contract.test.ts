import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { createPreparedNote } from '../src/lib/prepared-note-ingest';
import { commitNoteVersion } from '../src/lib/note-versioning';
import { validateNoteAnchors } from '../src/lib/note-anchors';
import { loadEffectiveTranscriptMarkdown } from '../src/lib/transcript-content';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

// Backup/restore contract (spec 216 §7, issue #895): a serialized snapshot of
// one library slice (transcript row + canonical markdown + note + revisions +
// anchors + tags) must round-trip byte-identically through delete + re-import
// with stable IDs, links, versions, and checksums.
describeIfDb('backup restore contract (spec 216)', () => {
  let userId = '';
  let storageDir = '';
  let previousStoragePath: string | undefined;

  beforeAll(async () => {
    previousStoragePath = process.env.STORAGE_LOCAL_PATH;
    storageDir = await mkdtemp(join(tmpdir(), 'voxen-backup-test-'));
    process.env.STORAGE_LOCAL_PATH = storageDir;
    const user = await db.user.create({
      data: { email: `backup-${Date.now()}@voxen.local`, name: 'Backup', status: 'APPROVED' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (previousStoragePath === undefined) delete process.env.STORAGE_LOCAL_PATH;
    else process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    await db.$disconnect();
  });

  it('round-trips transcript, note, revisions, anchors, tags, and assets', async () => {
    const { storagePut } = await import('../src/lib/storage');
    const mdBody =
      '# Atlas manual\n\nO Atlas guarda o cofre no bunker.\n\n## Anexo\n\nDetalhe do anexo Atlas.\n';
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/atlas-backup',
        title: 'Atlas backup',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/atlas-backup.md`,
        plainText: 'O Atlas guarda o cofre no bunker. Detalhe do anexo Atlas.',
        frontmatter: {},
      },
    });
    await storagePut({
      key: `workspaces/${userId}/transcripts/atlas-backup.md`,
      body: mdBody,
      contentType: 'text/markdown',
    });
    const tag = await db.tag.create({ data: { userId, name: 'Atlas', slug: 'atlas' } });
    await db.transcriptTag.create({ data: { transcriptId: transcript.id, tagId: tag.id } });

    const anchors = await validateNoteAnchors(userId, [
      {
        transcriptId: transcript.id,
        startLine: 3,
        endLine: 3,
        selectedQuote: 'O Atlas guarda o cofre no bunker.',
      },
    ]);
    const created = await createPreparedNote(userId, {
      title: 'Nota Atlas',
      content: 'Resumo curado do Atlas.',
      transcriptIds: [transcript.id],
      anchors,
      actor: 'USER',
    });
    const v2 = await commitNoteVersion({
      userId,
      noteId: created.id,
      expectedRevision: created.revision,
      actor: 'USER',
      changeSummary: 'expande resumo',
      changes: { content: 'Resumo curado do Atlas, expandido.' },
    });
    expect(v2.revision).toBe(2);

    // Export: snapshot everything a backup must carry.
    const note = await db.note.findUniqueOrThrow({ where: { id: created.id } });
    const revisions = await db.noteRevision.findMany({
      where: { noteId: created.id },
      orderBy: { revision: 'asc' },
    });
    const sources = await db.noteTranscriptSource.findMany({
      where: { noteId: created.id },
      include: { anchors: true },
    });
    const links = await db.noteTranscriptSource.findMany({ where: { noteId: created.id } });
    const storedMd = await (
      await import('../src/lib/storage')
    ).storageReadText(`workspaces/${userId}/transcripts/atlas-backup.md`);
    const transcriptRow = await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } });
    const snapshot = JSON.parse(
      JSON.stringify({
        note,
        revisions,
        sources,
        transcriptRow,
        storedMd,
        mdPath: transcriptRow.mdPath,
      }),
    );
    expect(revisions.length).toBe(2);
    expect(links.length).toBe(1);

    // Delete the slice (simulates loss), then restore from snapshot with stable IDs.
    await db.note.delete({ where: { id: created.id } });
    await db.transcript.delete({ where: { id: transcript.id } });
    await expect(
      loadEffectiveTranscriptMarkdown(userId, transcript.id).catch((error: unknown) => {
        throw error;
      }),
    ).rejects.toMatchObject({ name: 'TranscriptReadError' });

    await db.transcript.create({
      data: {
        id: snapshot.transcriptRow.id,
        userId,
        source: snapshot.transcriptRow.source,
        url: snapshot.transcriptRow.url,
        title: snapshot.transcriptRow.title,
        durationSec: snapshot.transcriptRow.durationSec,
        language: snapshot.transcriptRow.language,
        transcriptionMethod: snapshot.transcriptRow.transcriptionMethod,
        mdPath: snapshot.mdPath,
        plainText: snapshot.transcriptRow.plainText,
        frontmatter: {},
      },
    });
    await storagePut({
      key: snapshot.mdPath,
      body: snapshot.storedMd,
      contentType: 'text/markdown',
    });
    await db.transcriptTag.create({ data: { transcriptId: transcript.id, tagId: tag.id } });
    await db.note.create({
      data: {
        id: snapshot.note.id,
        userId,
        kind: 'NOTE',
        title: snapshot.note.title,
        content: snapshot.note.content,
        revision: 1,
      },
    });
    await db.noteTranscriptSource.create({
      data: { noteId: created.id, transcriptId: transcript.id, userId },
    });
    for (const anchor of snapshot.sources[0]?.anchors ?? []) {
      await db.noteTranscriptAnchor.create({
        data: {
          noteId: created.id,
          transcriptId: transcript.id,
          userId,
          startLine: anchor.startLine,
          endLine: anchor.endLine,
          startSec: anchor.startSec,
          endSec: anchor.endSec,
          selectedQuote: anchor.selectedQuote,
          quoteHash: anchor.quoteHash,
          sourceVersion: anchor.sourceVersion,
          sourceChecksum: anchor.sourceChecksum,
          status: 'VALID',
        },
      });
    }
    // Re-apply revision history in order (v1 baseline + v2 content).
    await db.noteRevision.create({
      data: {
        userId,
        noteId: created.id,
        revision: snapshot.revisions[0].revision,
        title: snapshot.revisions[0].title,
        content: snapshot.revisions[0].content,
        checksum: snapshot.revisions[0].checksum,
        actor: snapshot.revisions[0].actor,
      },
    });
    await commitNoteVersion({
      userId,
      noteId: created.id,
      expectedRevision: 1,
      actor: 'USER',
      changeSummary: 'expande resumo',
      changes: { content: snapshot.revisions[1].content },
    });

    // Verify: stable IDs/links, content, revisions, anchors, assets.
    const restored = await db.note.findUniqueOrThrow({ where: { id: created.id } });
    expect(restored.title).toBe('Nota Atlas');
    expect(restored.revision).toBe(2);
    expect(restored.content).toBe('Resumo curado do Atlas, expandido.');
    const restoredRevisions = await db.noteRevision.findMany({
      where: { noteId: created.id },
      orderBy: { revision: 'asc' },
    });
    expect(restoredRevisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(restoredRevisions[1]?.checksum).toBe(snapshot.revisions[1].checksum);
    const restoredMd = await loadEffectiveTranscriptMarkdown(userId, transcript.id);
    expect(restoredMd.md).toBe(mdBody);
    const restoredAnchors = await validateNoteAnchors(userId, [
      {
        transcriptId: transcript.id,
        startLine: 3,
        endLine: 3,
        selectedQuote: 'O Atlas guarda o cofre no bunker.',
      },
    ]);
    expect(restoredAnchors[0]?.status).toBe('VALID');
    const restoredTags = await db.transcriptTag.findMany({
      where: { transcriptId: transcript.id },
    });
    expect(restoredTags.map((row) => row.tagId)).toContain(tag.id);
  });
});
