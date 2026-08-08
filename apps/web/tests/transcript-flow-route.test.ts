import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { deleteSetting, getSetting, setSetting } from '../src/lib/settings';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const OWNER_EMAIL = 'transcript-flow-owner@voxen.local';
const FOREIGN_EMAIL = 'transcript-flow-foreign@voxen.local';
const PASSWORD = 'senha-super-segura-123';
const SETTING_KEYS = ['openrouter_api_key', 'default_chat_model', 'app_language'] as const;

let originalFetch: typeof globalThis.fetch;
const previousSettings = new Map<(typeof SETTING_KEYS)[number], string | null>();

async function signUp(email: string, name: string): Promise<string> {
  await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
  await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
  const response = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function postFlow(transcriptId: string, cookie: string, force = false): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost/api/transcripts/${transcriptId}/flow`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ force }),
      }),
    ),
  );
}

function mockOpenRouter(content: string): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    expect(String(input)).toContain('openrouter.ai/api/v1/chat/completions');
    return new Response(
      JSON.stringify({
        model: 'test/flow-model',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 120, completion_tokens: 40, cost: 0.0012 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
}

describeIfDb('transcript Mermaid flow API', () => {
  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    await db.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, FOREIGN_EMAIL] } } });
    for (const key of SETTING_KEYS) previousSettings.set(key, await getSetting(key));
    await setSetting('openrouter_api_key', `sk-or-v1-${'f'.repeat(40)}`);
    await setSetting('default_chat_model', 'test/flow-model');
    await setSetting('app_language', 'pt-BR');
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, FOREIGN_EMAIL] } } });
    for (const key of SETTING_KEYS) {
      const previous = previousSettings.get(key) ?? null;
      if (previous === null) await deleteSetting(key);
      else await setSetting(key, previous);
    }
    await db.$disconnect();
  });

  it('persists a safe flow, records cost, and keeps the endpoint isolated', async () => {
    const ownerCookie = await signUp(OWNER_EMAIL, 'Flow Owner');
    const foreignCookie = await signUp(FOREIGN_EMAIL, 'Flow Foreign');
    const owner = await db.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    const transcript = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'WEB',
        url: 'https://example.com/flow-source',
        title: 'A safe process',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${owner.id}/transcripts/flow-source.md`,
        plainText: 'Primeiro coletar. Depois validar. Por fim persistir.',
        summaryMd: '## Resumo\nUm processo de três etapas.',
        frontmatter: {},
      },
    });

    expect((await postFlow(transcript.id, foreignCookie)).status).toBe(404);
    mockOpenRouter('```mermaid\nflowchart TD\nN1[Coletar] --> N2[Validar] --> N3[Persistir]\n```');
    const response = await postFlow(transcript.id, ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      flowchartMd: 'flowchart TD\nN1[Coletar] --> N2[Validar] --> N3[Persistir]',
    });
    expect(
      (await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } })).flowchartMd,
    ).toContain('N1[Coletar]');
    const cost = await db.costEvent.findFirstOrThrow({
      where: { userId: owner.id, meta: { path: ['source'], equals: 'transcript_flowchart' } },
      orderBy: { ts: 'desc' },
    });
    expect(cost.model).toBe('test/flow-model');
    expect(cost.tokensIn).toBe(120);
  });

  it('requires confirmation and preserves an existing flow after unsafe output', async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    const signInResponse = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
      }),
    );
    const ownerCookie = (signInResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const transcript = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'WEB',
        url: 'https://example.com/unsafe-flow',
        title: 'Unsafe flow test',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${owner.id}/transcripts/unsafe-flow.md`,
        plainText: 'Conteúdo canônico que deve permanecer isolado.',
        flowchartMd: 'flowchart TD\nN1[Anterior] --> N2[Seguro]',
        frontmatter: {},
      },
    });

    expect((await postFlow(transcript.id, ownerCookie)).status).toBe(409);
    mockOpenRouter('flowchart TD\nN1[Open] --> N2[Bad]\nclick N1 href "https://evil.test"');
    expect((await postFlow(transcript.id, ownerCookie, true)).status).toBe(502);
    expect(
      (await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } })).flowchartMd,
    ).toBe('flowchart TD\nN1[Anterior] --> N2[Seguro]');
    const rejectedCost = await db.costEvent.findFirstOrThrow({
      where: {
        userId: owner.id,
        meta: { path: ['rejection_reason'], equals: 'MERMAID_FLOW_UNSAFE' },
      },
      orderBy: { ts: 'desc' },
    });
    expect(rejectedCost.costUsd.toString()).toBe('0.0012');

    const malformedTranscript = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'WEB',
        url: 'https://example.com/malformed-flow',
        title: 'Malformed flow test',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${owner.id}/transcripts/malformed-flow.md`,
        plainText: 'Outro conteúdo canônico que deve permanecer isolado.',
        flowchartMd: 'flowchart TD\nN1[Anterior] --> N2[Seguro]',
        frontmatter: {},
      },
    });
    mockOpenRouter('flowchart TD\nN1[foo[bar]]');
    expect((await postFlow(malformedTranscript.id, ownerCookie, true)).status).toBe(502);
    expect(
      (await db.transcript.findUniqueOrThrow({ where: { id: malformedTranscript.id } }))
        .flowchartMd,
    ).toBe('flowchart TD\nN1[Anterior] --> N2[Seguro]');
    expect(
      await db.costEvent.count({
        where: {
          userId: owner.id,
          meta: { path: ['rejection_reason'], equals: 'MERMAID_FLOW_SYNTAX_INVALID' },
        },
      }),
    ).toBe(1);
  });
});
