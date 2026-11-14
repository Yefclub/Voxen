import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { buildAssistantTools, type AssistantReference } from '../src/lib/assistant/tools';
import { claimAssistantRun, sendAssistantMessage } from '../src/lib/assistant/store';
import { storagePut } from '../src/lib/storage';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('assistant knowledge tools', () => {
  const users: string[] = [];
  const docs: string[] = [];
  const notes: string[] = [];
  const jobs: string[] = [];
  let tools: Awaited<ReturnType<typeof buildAssistantTools>>;
  const references = new Map<string, AssistantReference>();
  const options = { toolCallId: 'owned-read', messages: [], context: undefined };
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = (
        await db.user.create({
          data: {
            email: `assistant-tools-${randomUUID()}@example.test`,
            name: 'Tools',
            status: 'APPROVED',
          },
        })
      ).id;
      users.push(userId);
      const title = i ? 'Foreign confidential evidence' : 'Orion archived evidence';
      const mdPath = `tests/assistant-tools-${randomUUID()}.md`;
      await storagePut({
        key: mdPath,
        body: `# ${title}\n\n## Source passage\n\n[00:00:15] Orion uses revision 42.\n`,
        contentType: 'text/markdown',
      });
      docs.push(
        (
          await db.transcript.create({
            data: {
              userId,
              title,
              source: 'WEB',
              url: `https://example.com/${randomUUID()}`,
              durationSec: 0,
              language: 'en',
              transcriptionMethod: 'SCRAPE',
              mdPath,
              plainText: title + ' Orion uses revision 42.',
              frontmatter: {},
            },
          })
        ).id,
      );
      notes.push(
        (
          await db.note.create({
            data: {
              userId,
              kind: 'NOTE',
              title: 'Orion research note',
              content: i ? 'Foreign secret content' : 'An owned research note',
            },
          })
        ).id,
      );
      jobs.push(
        (
          await db.job.create({
            data: {
              userId,
              type: 'CAPTURE_LINK',
              status: 'QUEUED',
              sourceUrl: `https://example.com/${randomUUID()}`,
            },
          })
        ).id,
      );
    }
    const run = await sendAssistantMessage(users[0]!, {
      text: 'Find Orion evidence',
      revision: 0,
      requestKey: randomUUID(),
    });
    tools = await buildAssistantTools(
      (await claimAssistantRun(run.id))!,
      new AbortController().signal,
      references,
      async () => undefined,
    );
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  test('searches owned sources, reads their outline and passage, then verifies a literal quote', async () => {
    const found = await tools.search_knowledge!.execute!({ queries: ['Orion'] }, options);
    expect(JSON.stringify(found)).toContain(docs[0]!);
    expect(JSON.stringify(found)).not.toContain(docs[1]!);
    expect(JSON.stringify(found)).not.toContain(notes[1]!);
    const outline = await tools.read_document!.execute!({ id: docs[0] }, options);
    expect(JSON.stringify(outline)).toContain('Source passage');
    const passage = await tools.read_document!.execute!(
      { id: docs[0], fromLine: 1, toLine: 8 },
      options,
    );
    expect(JSON.stringify(passage)).toContain('Orion uses revision 42.');
    expect(
      await tools.verify_quote!.execute!(
        { id: docs[0], quote: 'Orion uses revision 42.' },
        options,
      ),
    ).toMatchObject({ supported: true });
    expect(
      [...references.values()].some((reference) => reference.id === docs[0] && reference.verified),
    ).toBe(true);
    expect(await tools.read_note!.execute!({ id: notes[0] }, options)).toMatchObject({
      content: 'An owned research note',
      revision: 1,
    });
  });

  test('foreign ids are indistinguishable from missing ids and do not populate references', async () => {
    for (const name of [
      'read_document',
      'verify_quote',
      'read_note',
      'read_enrichment',
      'capture_status',
    ]) {
      const foreignId =
        name === 'read_note' ? notes[1] : name === 'capture_status' ? jobs[1] : docs[1];
      const value = (id: string) => ({
        id,
        ...(name === 'verify_quote' && { quote: 'Orion uses revision 42.' }),
      });
      const foreign = await tools[name]!.execute!(value(foreignId!), options);
      const missing = await tools[name]!.execute!(value('missing-id'), options);
      expect(foreign).toEqual(missing);
    }
    expect([...references.values()].some((reference) => reference.id === docs[1])).toBe(false);
    expect(
      JSON.stringify(await tools.recent_content!.execute!({ days: 30 }, options)),
    ).not.toContain(docs[1]!);
    expect(tools.web_fetch).toBeUndefined();
    expect(tools.web_search).toBeUndefined();
  });

  test('continues beyond the first note window and rejects a changed revision', async () => {
    const note = await db.note.create({
      data: {
        userId: users[0]!,
        kind: 'NOTE',
        title: 'Long note',
        content: 'a'.repeat(15_999) + '😀 A distinctive passage beyond the initial window.',
      },
    });
    const first = (await tools.read_note!.execute!({ id: note.id }, options)) as {
      content: string;
      revision: number;
      nextOffset: number;
    };
    expect(first.content.length).toBeLessThanOrEqual(16_000);
    expect(first.content).not.toContain('distinctive passage');
    expect(first.nextOffset).toBeGreaterThan(0);
    expect(
      await tools.read_note!.execute!({ id: note.id, offset: first.nextOffset }, options),
    ).toMatchObject({ error: 'REVISION_REQUIRED' });
    const next = await tools.read_note!.execute!(
      { id: note.id, offset: first.nextOffset, expectedRevision: first.revision },
      options,
    );
    expect(next).toMatchObject({
      content: '😀 A distinctive passage beyond the initial window.',
      nextOffset: null,
      revision: 1,
    });
    await db.note.update({
      where: { id: note.id },
      data: { content: 'A changed note.', revision: { increment: 1 } },
    });
    expect(
      await tools.read_note!.execute!(
        { id: note.id, offset: first.nextOffset, expectedRevision: first.revision },
        options,
      ),
    ).toMatchObject({ error: 'STALE_REVISION', currentRevision: 2 });
  });
  test('reads accepted external context progressively without mixing revisions or ownership', async () => {
    const source = await db.transcript.findUniqueOrThrow({ where: { id: docs[0]! } });
    const context = await db.transcriptEnrichment.create({
      data: {
        userId: users[0]!,
        transcriptId: source.id,
        runKey: randomUUID(),
        status: 'READY',
        reviewState: 'ACCEPTED',
        trigger: 'MANUAL',
        title: 'Long curated context',
        content: 'a'.repeat(15_999) + '😀 The distinctive external passage.',
        sourceVersion: source.sourceVersion,
        sourceChecksum: source.sourceChecksum,
        editedAt: new Date(),
        citations: [
          {
            url: 'https://example.org/evidence',
            title: 'Evidence',
            excerpt: 'A verified supporting passage.',
            retrievedAt: new Date().toISOString(),
          },
        ],
      },
    });
    const first = (await tools.read_enrichment!.execute!({ id: context.id }, options)) as {
      content: string;
      nextOffset: number;
      revision: number;
    };
    expect(first.content).toHaveLength(15_999);
    expect(first).toMatchObject({ revision: context.revision, authority: 'external-curated' });
    expect(
      await tools.read_enrichment!.execute!({ id: context.id, offset: first.nextOffset }, options),
    ).toMatchObject({ error: 'REVISION_REQUIRED' });
    expect(
      await tools.read_enrichment!.execute!(
        { id: context.id, offset: first.nextOffset, expectedRevision: first.revision },
        options,
      ),
    ).toMatchObject({ content: '😀 The distinctive external passage.', nextOffset: null });
    const changed = await db.transcriptEnrichment.update({
      where: { id: context.id },
      data: { content: 'Revised context', revision: { increment: 1 } },
    });
    expect(
      await tools.read_enrichment!.execute!(
        { id: context.id, offset: first.nextOffset, expectedRevision: first.revision },
        options,
      ),
    ).toMatchObject({ error: 'STALE_REVISION', currentRevision: changed.revision });
    await db.transcriptEnrichment.update({
      where: { id: context.id },
      data: { reviewState: 'SUGGESTED' },
    });
    expect(await tools.read_enrichment!.execute!({ id: context.id }, options)).toEqual({
      error: 'NOT_FOUND',
    });
    const foreign = await db.transcript.findUniqueOrThrow({ where: { id: docs[1]! } });
    const other = await db.transcriptEnrichment.create({
      data: {
        userId: users[1]!,
        transcriptId: foreign.id,
        runKey: randomUUID(),
        status: 'READY',
        reviewState: 'ACCEPTED',
        trigger: 'MANUAL',
        title: 'Private context',
        content: 'Private',
        sourceVersion: foreign.sourceVersion,
        sourceChecksum: foreign.sourceChecksum,
      },
    });
    expect(await tools.read_enrichment!.execute!({ id: other.id }, options)).toEqual({
      error: 'NOT_FOUND',
    });
  });
});
