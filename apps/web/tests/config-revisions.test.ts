import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import {
  getCurrentConfigRevisionId,
  getSetting,
  rollbackConfigRevision,
  setSettings,
} from '../src/lib/settings';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

function cookie(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function createUser(email: string): Promise<{ id: string; cookie: string }> {
  const password = 'senha-super-segura-123';
  await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: email }),
    }),
  );
  const login = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { id: user.id, cookie: cookie(login) };
}

describeIfDb('configuração global auditável', () => {
  beforeEach(async () => {
    await db.configRevision.deleteMany();
    await db.setting.deleteMany();
    await db.session.deleteMany();
    await db.account.deleteMany();
    await db.verification.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    await db.configRevision.deleteMany();
    await db.setting.deleteMany();
    await db.$disconnect();
  });

  it('cria uma revisão atômica com executor e sem reter segredo', async () => {
    const admin = await createUser('admin-revisao@voxen.local');
    await setSettings(
      { mcp_api_token: 'tok-' + 'x'.repeat(40), app_language: 'en' },
      { actorUserId: admin.id, reason: 'Troca de chave' },
    );

    const revision = await db.configRevision.findUniqueOrThrow({
      where: { number: 1 },
      include: { changes: { orderBy: { key: 'asc' } } },
    });
    expect(revision.actorUserId).toBe(admin.id);
    expect(revision.reason).toBe('Troca de chave');
    expect(revision.changes).toHaveLength(2);
    expect(revision.changes.find((change) => change.key === 'mcp_api_token')).toMatchObject({
      isSecret: true,
      previousValue: null,
      nextValue: null,
    });
    expect(revision.changes.find((change) => change.key === 'app_language')).toMatchObject({
      isSecret: false,
      previousValue: null,
      nextValue: 'en',
    });
    await expect(getCurrentConfigRevisionId()).resolves.toBe(revision.id);
  });

  it('expõe somente diff redigido a administradores', async () => {
    const admin = await createUser('admin-historico@voxen.local');
    await setSettings(
      { mcp_api_token: 'tok-' + 'x'.repeat(40), app_language: 'en' },
      { actorUserId: admin.id },
    );

    const response = await app.fetch(
      new Request('http://localhost/api/admin/config-revisions', {
        headers: { cookie: admin.cookie },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      revisions: Array<{
        changes: Array<{
          key: string;
          isSecret: boolean;
          previousValue: string | null;
          nextValue: string | null;
        }>;
      }>;
    };
    const secret = body.revisions[0]?.changes.find((change) => change.key === 'mcp_api_token');
    expect(secret).toEqual({
      key: 'mcp_api_token',
      isSecret: true,
      previousValue: null,
      nextValue: null,
    });
  });

  it('redige uma URL de proxy que pode conter credenciais', async () => {
    await setSettings({ mcp_api_token: 'tok-usuario-senha-proxy-local' });

    const revision = await db.configRevision.findUniqueOrThrow({
      where: { number: 1 },
      include: { changes: true },
    });
    expect(revision.changes).toContainEqual(
      expect.objectContaining({
        key: 'mcp_api_token',
        isSecret: true,
        previousValue: null,
        nextValue: null,
      }),
    );
  });

  it('nega histórico administrativo para usuários comuns', async () => {
    const admin = await createUser('admin-autorizacao@voxen.local');
    const member = await createUser('membro-autorizacao@voxen.local');
    await db.user.update({ where: { id: member.id }, data: { role: 'USER', status: 'APPROVED' } });
    const login = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'membro-autorizacao@voxen.local',
          password: 'senha-super-segura-123',
        }),
      }),
    );
    await setSettings({ app_language: 'en' }, { actorUserId: admin.id });

    const response = await app.fetch(
      new Request('http://localhost/api/admin/config-revisions', {
        headers: { cookie: cookie(login) },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('faz rollback apenas de valores não secretos e registra nova revisão', async () => {
    const admin = await createUser('admin-rollback@voxen.local');
    await setSettings(
      { app_language: 'en', mcp_api_token: 'tok-' + 'x'.repeat(40) },
      { actorUserId: admin.id },
    );
    await setSettings({ app_language: 'pt-BR' }, { actorUserId: admin.id });

    const result = await rollbackConfigRevision(2, {
      actorUserId: admin.id,
      reason: 'Desfazer idioma',
    });
    expect(result.skippedSecretKeys).toEqual([]);
    expect(result.revision?.number).toBe(3);
    await expect(getSetting('app_language')).resolves.toBe('en');

    const secretRollback = await rollbackConfigRevision(1, { actorUserId: admin.id });
    expect(secretRollback.skippedSecretKeys).toEqual(['mcp_api_token']);
    await expect(getSetting('mcp_api_token')).resolves.toBe('tok-' + 'x'.repeat(40));
  });

  it('audita a tentativa de rollback de uma revisão somente secreta', async () => {
    const admin = await createUser('admin-rollback-segredo@voxen.local');
    await setSettings({ mcp_api_token: 'tok-' + 'x'.repeat(40) }, { actorUserId: admin.id });

    const result = await rollbackConfigRevision(1, { actorUserId: admin.id });
    expect(result.revision?.number).toBe(2);
    expect(result.skippedSecretKeys).toEqual(['mcp_api_token']);
    const rollback = await db.configRevision.findUniqueOrThrow({
      where: { number: 2 },
      include: { changes: true },
    });
    expect(rollback.changes).toEqual([
      expect.objectContaining({ key: 'mcp_api_token', isSecret: true }),
    ]);
  });

  it('recusa rollback de uma revisão-base', async () => {
    await db.configRevision.create({
      data: {
        number: 1,
        isBaseline: true,
        changes: { create: { key: 'app_language', previousValue: null, nextValue: null } },
      },
    });

    await expect(rollbackConfigRevision(1, {})).rejects.toThrow(
      'A revisão-base não pode ser revertida.',
    );
  });

  it('vincula jobs novos à revisão vigente', async () => {
    const admin = await createUser('admin-execucoes@voxen.local');
    await setSettings({ app_language: 'en' }, { actorUserId: admin.id });
    const revisionId = await getCurrentConfigRevisionId();

    const job = await db.job.create({
      data: {
        userId: admin.id,
        type: 'SCRAPE_WEB',
        status: 'QUEUED',
        sourceUrl: 'https://exemplo.local/revisao',
        configRevisionId: revisionId,
      },
      select: { configRevisionId: true },
    });
    expect(job.configRevisionId).toBe(revisionId);
  });
});
