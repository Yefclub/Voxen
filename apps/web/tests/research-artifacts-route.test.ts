import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { deleteSetting, getSetting, setSetting } from '../src/lib/settings';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;
const PASSWORD = 'senha-super-segura-123';

type Fixture = {
  ownerCookie: string;
  otherCookie: string;
  ownerId: string;
  otherId: string;
  sourceId: string;
};

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

async function signUp(email: string, name: string): Promise<void> {
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  expect(response.status).toBe(200);
}

async function signIn(email: string): Promise<string> {
  const response = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function withCookie(cookie: string, body?: unknown): RequestInit {
  return {
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describeIfDb('artefatos de pesquisa API', () => {
  let fixture: Fixture;
  let previousAllowSignups: string | null = null;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    previousAllowSignups = await getSetting('allow_signups').catch(() => null);
    await setSetting('allow_signups', 'true');
    const ownerEmail = `artifacts-owner-${suffix}@voxen.local`;
    const otherEmail = `artifacts-other-${suffix}@voxen.local`;
    await Promise.all([
      signUp(ownerEmail, 'Dono dos artefatos'),
      signUp(otherEmail, 'Outro usuário'),
    ]);
    const [owner, other] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: ownerEmail } }),
      db.user.findUniqueOrThrow({ where: { email: otherEmail } }),
    ]);
    await db.user.updateMany({
      where: { id: { in: [owner.id, other.id] } },
      data: { status: 'APPROVED' },
    });
    const source = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'WEB',
        url: `https://example.com/artifacts-${suffix}`,
        title: 'Fonte verificável',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${owner.id}/transcripts/artifacts-${suffix}.md`,
        plainText: 'Evidência preservada para validar as citações do artefato.',
        frontmatter: {},
      },
    });
    const [ownerCookie, otherCookie] = await Promise.all([signIn(ownerEmail), signIn(otherEmail)]);
    fixture = {
      ownerCookie,
      otherCookie,
      ownerId: owner.id,
      otherId: other.id,
      sourceId: source.id,
    };
  });

  afterAll(async () => {
    if (previousAllowSignups === null) await deleteSetting('allow_signups').catch(() => undefined);
    else await setSetting('allow_signups', previousAllowSignups);
    if (fixture)
      await db.user.deleteMany({ where: { id: { in: [fixture.ownerId, fixture.otherId] } } });
    await db.$disconnect();
  });

  it('gera apenas com fontes do usuário e preserva a citação navegável', async () => {
    const response = await request(
      '/api/research-artifacts',
      withCookie(fixture.ownerCookie, { type: 'FAQ', transcriptIds: [fixture.sourceId] }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      artifact: { id: string; citations: Array<{ sourceId: string; href: string; quote: string }> };
    };
    expect(body.artifact.citations).toEqual([
      expect.objectContaining({
        sourceId: fixture.sourceId,
        href: `/transcricoes/${fixture.sourceId}#l=1`,
        quote: expect.stringContaining('Evidência preservada'),
      }),
    ]);

    const foreignRead = await request(
      `/api/research-artifacts/${body.artifact.id}`,
      withCookie(fixture.otherCookie),
    );
    expect(foreignRead.status).toBe(404);

    const foreignCreate = await request(
      '/api/research-artifacts',
      withCookie(fixture.otherCookie, { type: 'BRIEFING', transcriptIds: [fixture.sourceId] }),
    );
    expect(foreignCreate.status).toBe(400);
  });

  it('não aceita geração sem nenhum escopo de fontes', async () => {
    const response = await request(
      '/api/research-artifacts',
      withCookie(fixture.ownerCookie, { type: 'BRIEFING' }),
    );
    expect(response.status).toBe(400);
  });
});
