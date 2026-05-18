// ============================================================================
// Integration tests — /api/chat/conversations CRUD (#38)
// ============================================================================
// Roda contra Postgres real. Skipa se DATABASE_URL não está setado.
// ============================================================================

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function wipeDb(): Promise<void> {
  await db.chatMessage.deleteMany();
  await db.conversation.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
}

async function signUp(email: string, password: string, name: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),
  );
}

async function signIn(email: string, password: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function cookieOf(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

async function setupApprovedUser(): Promise<string> {
  await signUp('admin@voxen.local', 'senha-super-segura-12chars', 'Admin');
  const signin = await signIn('admin@voxen.local', 'senha-super-segura-12chars');
  return cookieOf(signin);
}

describeIfDb('/api/chat/conversations CRUD', () => {
  beforeEach(async () => {
    await wipeDb();
  });
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
  });

  it('lista vazia pra user novo', async () => {
    const cookie = await setupApprovedUser();
    const res = await app.fetch(
      new Request('http://localhost/api/chat/conversations', { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: unknown[] };
    expect(body.conversations).toEqual([]);
  });

  it('cria conversa com título auto-default', async () => {
    const cookie = await setupApprovedUser();
    const res = await app.fetch(
      new Request('http://localhost/api/chat/conversations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: { id: string; title: string } };
    expect(body.conversation.id).toBeTruthy();
    expect(body.conversation.title).toBe('Nova conversa');
  });

  it('cria conversa com título customizado', async () => {
    const cookie = await setupApprovedUser();
    const res = await app.fetch(
      new Request('http://localhost/api/chat/conversations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Minha conversa' }),
      }),
    );
    const body = (await res.json()) as { conversation: { title: string } };
    expect(body.conversation.title).toBe('Minha conversa');
  });

  it('GET /:id retorna conversa + mensagens vazias', async () => {
    const cookie = await setupApprovedUser();
    const create = await app.fetch(
      new Request('http://localhost/api/chat/conversations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const id = (await create.json()).conversation.id;

    const res = await app.fetch(
      new Request(`http://localhost/api/chat/conversations/${id}`, { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation: { id: string };
      messages: unknown[];
    };
    expect(body.conversation.id).toBe(id);
    expect(body.messages).toEqual([]);
  });

  it('PATCH /:id atualiza title e thinking', async () => {
    const cookie = await setupApprovedUser();
    const create = await app.fetch(
      new Request('http://localhost/api/chat/conversations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const id = (await create.json()).conversation.id;

    const res = await app.fetch(
      new Request(`http://localhost/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renomeada', thinking: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation: { title: string; thinking: boolean };
    };
    expect(body.conversation.title).toBe('Renomeada');
    expect(body.conversation.thinking).toBe(true);
  });

  it('DELETE /:id remove conversa + retorna 404 depois', async () => {
    const cookie = await setupApprovedUser();
    const create = await app.fetch(
      new Request('http://localhost/api/chat/conversations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const id = (await create.json()).conversation.id;

    const del = await app.fetch(
      new Request(`http://localhost/api/chat/conversations/${id}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(del.status).toBe(200);

    const get = await app.fetch(
      new Request(`http://localhost/api/chat/conversations/${id}`, { headers: { cookie } }),
    );
    expect(get.status).toBe(404);
  });

  it('sem auth retorna 401', async () => {
    const res = await app.fetch(new Request('http://localhost/api/chat/conversations'));
    expect(res.status).toBe(401);
  });
});
