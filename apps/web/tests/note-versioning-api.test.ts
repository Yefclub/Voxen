import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { acquireGraphIndexLease, releaseGraphIndexLease } from '../src/lib/graph-index-coordinator';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const PASSWORD = 'safe-note-versioning-password-123';

async function request(
  path: string,
  cookie: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function signUpAndApprove(
  email: string,
  name: string,
): Promise<{ id: string; cookie: string }> {
  const signup = await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
  expect(signup.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  await db.user.update({ where: { id: user.id }, data: { status: 'APPROVED' } });
  const signin = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  expect(signin.status).toBe(200);
  return { id: user.id, cookie: (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
}

describeIfDb('versioned and surgical notes API', () => {
  let owner: { id: string; cookie: string };
  let foreign: { id: string; cookie: string };
  let noteId = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    owner = await signUpAndApprove(`note-api-owner-${suffix}@voxen.local`, 'Note owner');
    foreign = await signUpAndApprove(`note-api-foreign-${suffix}@voxen.local`, 'Foreign owner');
  });

  afterAll(async () => {
    if (owner?.id) await db.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    if (foreign?.id) await db.user.delete({ where: { id: foreign.id } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('creation atomically stores revision 1 and targeted search is bounded', async () => {
    const created = await request('/api/notes', owner.cookie, 'POST', {
      kind: 'NOTE',
      title: 'Surgical note',
      content: 'First line\nTarget passage\nLast target passage',
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      note: { id: string; revision: number };
      graphSync: string;
    };
    noteId = createdBody.note.id;
    expect(createdBody.note.revision).toBe(1);
    expect(['READY', 'PENDING']).toContain(createdBody.graphSync);
    expect(await db.noteRevision.count({ where: { noteId } })).toBe(1);

    const search = await request(`/api/notes/${noteId}/search?q=target&limit=1`, owner.cookie);
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      revision: number;
      matches: Array<{ line: number; occurrence: number; context: string }>;
    };
    expect(searchBody.revision).toBe(1);
    expect(searchBody.matches).toHaveLength(1);
    expect(searchBody.matches[0]).toMatchObject({ line: 2, occurrence: 1 });
  });

  test('preview is non-destructive, apply is atomic, and stale apply conflicts', async () => {
    const operation = { kind: 'replace', target: 'Target passage', text: 'Revised passage' };
    const preview = await request(`/api/notes/${noteId}/patch/preview`, owner.cookie, 'POST', {
      expectedRevision: 1,
      operation,
    });
    expect(preview.status).toBe(200);
    expect((await db.note.findUniqueOrThrow({ where: { id: noteId } })).revision).toBe(1);

    const applied = await request(`/api/notes/${noteId}/patch`, owner.cookie, 'POST', {
      expectedRevision: 1,
      operation,
    });
    expect(applied.status).toBe(200);
    const appliedBody = (await applied.json()) as { note: { revision: number; content: string } };
    expect(appliedBody.note.revision).toBe(2);
    expect(appliedBody.note.content).toContain('Revised passage');

    const stale = await request(`/api/notes/${noteId}/patch`, owner.cookie, 'POST', {
      expectedRevision: 1,
      operation: { kind: 'append', text: '\nstale writer' },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 });
    expect(await db.noteRevision.count({ where: { noteId } })).toBe(2);
  });

  test('history can restore by creating a new head revision', async () => {
    const history = await request(`/api/notes/${noteId}/revisions`, owner.cookie);
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as { revisions: Array<{ revision: number }> };
    expect(historyBody.revisions.map((item) => item.revision)).toEqual([2, 1]);

    const restore = await request(
      `/api/notes/${noteId}/revisions/1/restore`,
      owner.cookie,
      'POST',
      { expectedRevision: 2 },
    );
    expect(restore.status).toBe(200);
    const restored = (await restore.json()) as {
      note: { revision: number; content: string };
      restoredFromRevision: number;
    };
    expect(restored.note.revision).toBe(3);
    expect(restored.note.content).toContain('Target passage');
    expect(restored.restoredFromRevision).toBe(1);
    expect(await db.noteRevision.count({ where: { noteId } })).toBe(3);
  });

  test('history pagination exposes every revision beyond the first 100', async () => {
    const pagedNote = await db.note.create({
      data: {
        userId: owner.id,
        kind: 'NOTE',
        title: 'Long history',
        content: 'Current content',
        revision: 105,
      },
    });
    await db.noteRevision.createMany({
      data: Array.from({ length: 105 }, (_, index) => {
        const revision = index + 1;
        return {
          id: crypto.randomUUID(),
          userId: owner.id,
          noteId: pagedNote.id,
          revision,
          title: 'Long history',
          content: `Revision ${revision}`,
          checksum: `checksum-${revision}`,
          actor: 'USER' as const,
          changeSummary: `Revision ${revision}`,
        };
      }),
    });

    const first = await request(`/api/notes/${pagedNote.id}/revisions?limit=40`, owner.cookie);
    const firstBody = (await first.json()) as {
      revisions: Array<{ revision: number }>;
      nextBefore: number | null;
    };
    expect(firstBody.revisions).toHaveLength(40);
    expect(firstBody.revisions[0]?.revision).toBe(105);
    expect(firstBody.revisions.at(-1)?.revision).toBe(66);
    expect(firstBody.nextBefore).toBe(66);

    const second = await request(
      `/api/notes/${pagedNote.id}/revisions?limit=40&before=${firstBody.nextBefore}`,
      owner.cookie,
    );
    const secondBody = (await second.json()) as {
      revisions: Array<{ revision: number }>;
      nextBefore: number | null;
    };
    expect(secondBody.revisions[0]?.revision).toBe(65);
    expect(secondBody.revisions.at(-1)?.revision).toBe(26);
    expect(secondBody.nextBefore).toBe(26);

    const third = await request(
      `/api/notes/${pagedNote.id}/revisions?limit=40&before=${secondBody.nextBefore}`,
      owner.cookie,
    );
    const thirdBody = (await third.json()) as {
      revisions: Array<{ revision: number }>;
      nextBefore: number | null;
    };
    expect(thirdBody.revisions.map((revision) => revision.revision)).toEqual(
      Array.from({ length: 25 }, (_, index) => 25 - index),
    );
    expect(thirdBody.nextBefore).toBeNull();
  });

  test('foreign users cannot discover search, revisions, preview, or mutation', async () => {
    const responses = await Promise.all([
      request(`/api/notes/${noteId}/search?q=target`, foreign.cookie),
      request(`/api/notes/${noteId}/revisions`, foreign.cookie),
      request(`/api/notes/${noteId}/patch/preview`, foreign.cookie, 'POST', {
        expectedRevision: 3,
        operation: { kind: 'append', text: 'forbidden' },
      }),
      request(`/api/notes/${noteId}/patch`, foreign.cookie, 'POST', {
        expectedRevision: 3,
        operation: { kind: 'append', text: 'forbidden' },
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
  });

  test('a held graph lease reports pending without rolling back the note commit', async () => {
    const leaseOwner = `note-api-test:${crypto.randomUUID()}`;
    expect(await acquireGraphIndexLease(owner.id, leaseOwner)).toBe(true);
    try {
      const response = await request(`/api/notes/${noteId}/patch`, owner.cookie, 'POST', {
        expectedRevision: 3,
        operation: { kind: 'append', text: '\nCommitted while graph is busy.' },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { note: { revision: number }; graphSync: string };
      expect(body.note.revision).toBe(4);
      expect(body.graphSync).toBe('PENDING');
    } finally {
      await releaseGraphIndexLease(owner.id, leaseOwner);
    }
    expect((await db.note.findUniqueOrThrow({ where: { id: noteId } })).revision).toBe(4);
  });

  test('full saves preserve explicit sources and manual graph evidence while refreshing only the note', async () => {
    const transcript = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'WEB',
        url: `https://example.com/note-source-${crypto.randomUUID()}`,
        title: 'Explicit source',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${owner.id}/transcripts/note-source.md`,
        plainText: 'Evidence retained by the note.',
        frontmatter: {},
      },
    });
    const linked = await request(`/api/notes/${noteId}`, owner.cookie, 'PATCH', {
      expectedRevision: 4,
      sourceTranscriptIds: [transcript.id],
    });
    expect(linked.status).toBe(200);
    expect((await linked.json()) as { note: { revision: number } }).toMatchObject({
      note: { revision: 5 },
    });

    const sourceNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: owner.id, key: `NOTE:${noteId}` } },
    });
    const manualNode = await db.brainNode.create({
      data: {
        userId: owner.id,
        key: `MANUAL:note-api-${crypto.randomUUID()}`,
        type: 'ENTITY',
        label: 'Manual relation target',
      },
    });
    const manualEdge = await db.brainEdge.create({
      data: {
        userId: owner.id,
        fromNodeId: sourceNode.id,
        toNodeId: manualNode.id,
        kind: 'RELATED_TO',
        method: 'manual',
      },
    });

    const saved = await request(`/api/notes/${noteId}`, owner.cookie, 'PATCH', {
      expectedRevision: 5,
      title: 'Surgical note renamed',
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()) as { note: { revision: number } }).toMatchObject({
      note: { revision: 6 },
    });
    expect(
      await db.noteTranscriptSource.findUnique({
        where: { noteId_transcriptId: { noteId, transcriptId: transcript.id } },
      }),
    ).not.toBeNull();
    expect(await db.brainEdge.findUnique({ where: { id: manualEdge.id } })).not.toBeNull();
  });
});
