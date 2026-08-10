import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const PASSWORD = 'safe-transcript-corrections-password-123';

async function request(path: string, cookie: string): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      headers: { cookie },
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

describeIfDb('transcript correction history API', () => {
  let owner: { id: string; cookie: string };
  let foreign: { id: string; cookie: string };
  let transcriptId = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    owner = await signUpAndApprove(
      `transcript-history-owner-${suffix}@voxen.local`,
      'Transcript owner',
    );
    foreign = await signUpAndApprove(
      `transcript-history-foreign-${suffix}@voxen.local`,
      'Foreign owner',
    );
    const transcript = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'WEB',
        url: `https://example.test/transcript-history-${suffix}`,
        title: 'Long correction history',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: `tests/transcript-history-${suffix}.md`,
        plainText: 'Canonical content',
        frontmatter: {},
        correctionRevision: 105,
      },
    });
    transcriptId = transcript.id;
    await db.transcriptCorrectionRevision.createMany({
      data: Array.from({ length: 105 }, (_, index) => {
        const revision = index + 1;
        return {
          userId: owner.id,
          transcriptId,
          revision,
          sourceVersion: 0,
          markdown: `# Revision ${revision}`,
          plainText: `Revision ${revision}`,
          checksum: `checksum-${revision}`,
          actor: 'USER' as const,
          operation: { kind: 'append', text: `Revision ${revision}` },
          changeSummary: `Revision ${revision}`,
        };
      }),
    });
  });

  afterAll(async () => {
    if (owner?.id) await db.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    if (foreign?.id) await db.user.delete({ where: { id: foreign.id } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('paginates every immutable revision with an owner-scoped cursor', async () => {
    const first = await request(
      `/api/transcripts/${transcriptId}/corrections/revisions?limit=40`,
      owner.cookie,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      revisions: Array<{ revision: number }>;
      nextBefore: number | null;
    };
    expect(firstBody.revisions).toHaveLength(40);
    expect(firstBody.revisions[0]?.revision).toBe(105);
    expect(firstBody.revisions.at(-1)?.revision).toBe(66);
    expect(firstBody.nextBefore).toBe(66);

    const second = await request(
      `/api/transcripts/${transcriptId}/corrections/revisions?limit=40&before=66`,
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
      `/api/transcripts/${transcriptId}/corrections/revisions?limit=40&before=26`,
      owner.cookie,
    );
    const thirdBody = (await third.json()) as {
      revisions: Array<{ revision: number }>;
      nextBefore: number | null;
    };
    expect(thirdBody.revisions.map((item) => item.revision)).toEqual(
      Array.from({ length: 25 }, (_, index) => 25 - index),
    );
    expect(thirdBody.nextBefore).toBeNull();

    const hidden = await request(
      `/api/transcripts/${transcriptId}/corrections/revisions`,
      foreign.cookie,
    );
    expect(hidden.status).toBe(404);
  });
});
