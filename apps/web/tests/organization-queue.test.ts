import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';
import {
  getOrganizationPreferences,
  saveOrganizationPreferences,
} from '../src/lib/organization/preferences';
import { enqueueOrganization } from '../src/lib/organization/queue';

const root = mkdtempSync(join(tmpdir(), 'voxen-organization-queue-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
const body = 'Orion is explicitly part of the Vega product family.';

suite('owner-bound organization consent and queue', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `organization-queue-${randomUUID()}@example.test`,
              name: 'Organization queue',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
    await db.setting.deleteMany({ where: { userId: { in: users }, scope: 'USER' } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
    rmSync(root, { recursive: true, force: true });
  });
  async function document(userId = users[0]!, captured = false, collectedAt = new Date()) {
    const id = randomUUID();
    const mdPath = `workspaces/${userId}/transcripts/${id}/source.md`;
    await storagePut({ key: mdPath, body, contentType: 'text/markdown' });
    return db.transcript.create({
      data: {
        id,
        userId,
        source: 'WEB',
        url: `https://example.test/${id}`,
        title: 'Organization source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath,
        plainText: body,
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'original-checksum',
        sourceCollectedAt: collectedAt,
        sourceMetadata: captured
          ? {
              producer: 'voxen-capture',
              evidenceManifest: createSourceEvidenceManifest(body, [
                { start: 0, end: body.length },
              ]),
            }
          : { producer: 'prepared-fixture' },
      },
    });
  }
  test('defaults to off and never queues without current consent', async () => {
    const source = await document();
    expect(await getOrganizationPreferences(users[0]!)).toEqual({
      mode: 'OFF',
      automaticSince: null,
    });
    expect(await enqueueOrganization(users[0]!, source.id, 'AUTO')).toBeNull();
    await expect(enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID())).rejects.toThrow(
      'DISABLED',
    );
    expect(await db.organizationRun.count({ where: { userId: users[0] } })).toBe(0);
  });
  test('does not reveal foreign, missing or inactive documents', async () => {
    const foreign = await document(users[1]);
    const archived = await document();
    await db.transcript.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });
    await saveOrganizationPreferences(users[0]!, 'MANUAL');
    for (const id of [foreign.id, archived.id, 'missing-id'])
      await expect(enqueueOrganization(users[0]!, id, 'MANUAL', randomUUID())).rejects.toThrow(
        'NOT_FOUND',
      );
  });
  test('deduplicates concurrent requests and preserves completed request identities', async () => {
    const source = await document();
    await saveOrganizationPreferences(users[0]!, 'MANUAL');
    const key = randomUUID();
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => enqueueOrganization(users[0]!, source.id, 'MANUAL', key)),
    );
    expect(new Set(runs.map((run) => run!.id)).size).toBe(1);
    expect(runs[0]!.generationSettings).toMatchObject({
      executorVersion: 1,
      role: 'standard',
      snapshot: { sourceVersion: 1, capturedSource: false },
    });
    const secondKey = randomUUID();
    expect((await enqueueOrganization(users[0]!, source.id, 'MANUAL', secondKey))!.id).toBe(
      runs[0]!.id,
    );
    await db.organizationRun.update({ where: { id: runs[0]!.id }, data: { status: 'COMPLETED' } });
    expect((await enqueueOrganization(users[0]!, source.id, 'MANUAL', key))!.id).toBe(runs[0]!.id);
    expect((await enqueueOrganization(users[0]!, source.id, 'MANUAL', secondKey))!.id).toBe(
      runs[0]!.id,
    );
    expect(
      await db.organizationRun.count({ where: { userId: users[0]!, transcriptId: source.id } }),
    ).toBe(1);
    expect((await enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID()))!.id).not.toBe(
      runs[0]!.id,
    );
  });
  test('retains an automatic request coalesced into an active manual run', async () => {
    await saveOrganizationPreferences(users[0]!, 'AUTO');
    const source = await document(users[0], true);
    const manual = (await enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    expect((await enqueueOrganization(users[0]!, source.id, 'AUTO'))!.id).toBe(manual.id);
    await db.organizationRun.update({ where: { id: manual.id }, data: { status: 'COMPLETED' } });
    expect((await enqueueOrganization(users[0]!, source.id, 'AUTO'))!.id).toBe(manual.id);
    expect(
      await db.organizationRun.count({ where: { userId: users[0]!, transcriptId: source.id } }),
    ).toBe(1);
  });
  test('automatic work accepts only captures collected since the current consent', async () => {
    const before = await document(users[0], true, new Date(0));
    await db.transcript.update({
      where: { id: before.id },
      data: { mdPath: 'legacy-unavailable.md', sourceMetadata: { producer: 'voxen-capture' } },
    });
    const prepared = await document();
    const policy = await saveOrganizationPreferences(users[0]!, 'AUTO');
    const source = await document(users[0], true);
    expect(await enqueueOrganization(users[0]!, before.id, 'AUTO')).toBeNull();
    expect(await enqueueOrganization(users[0]!, prepared.id, 'AUTO')).toBeNull();
    const first = (await enqueueOrganization(users[0]!, source.id, 'AUTO'))!;
    expect(first).toBeTruthy();
    expect((await enqueueOrganization(users[0]!, source.id, 'AUTO'))!.id).toBe(first.id);
    expect(await saveOrganizationPreferences(users[0]!, 'AUTO')).toEqual(policy);
    await db.transcript.update({
      where: { id: source.id },
      data: { sourceVersion: 2, sourceCollectedAt: new Date() },
    });
    const refreshed = (await enqueueOrganization(users[0]!, source.id, 'AUTO'))!;
    expect(refreshed.id).not.toBe(first.id);
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: first.id, userId: users[0] } }),
    ).toMatchObject({ status: 'CANCELLED', lastError: 'SOURCE_CHANGED', leaseOwner: null });
  });
  test('policy cancellation is owner-scoped and retains completed results and legacy compilation records', async () => {
    const source = await document();
    const foreign = await document(users[1]);
    await saveOrganizationPreferences(users[0]!, 'MANUAL');
    await saveOrganizationPreferences(users[1]!, 'MANUAL');
    const one = (await enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    const two = (await enqueueOrganization(users[1]!, foreign.id, 'MANUAL', randomUUID()))!;
    const legacy = await db.brainCompilation.create({
      data: {
        userId: users[0]!,
        transcriptId: source.id,
        contentHash: 'legacy',
        status: 'PENDING',
      },
    });
    await db.organizationRun.update({ where: { id: one.id }, data: { status: 'COMPLETED' } });
    const pending = (await enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    await saveOrganizationPreferences(users[0]!, 'OFF');
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: pending.id, userId: users[0] } }),
    ).toMatchObject({
      status: 'CANCELLED',
      lastError: 'POLICY_CHANGED',
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: one.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED' });
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: two.id, userId: users[1] } }),
    ).toMatchObject({ status: 'PENDING', cancelRequestedAt: null });
    expect(
      await db.brainCompilation.findFirstOrThrow({ where: { id: legacy.id, userId: users[0] } }),
    ).toEqual(legacy);
    expect(
      await db.transcript.findFirstOrThrow({ where: { id: source.id, userId: users[0] } }),
    ).toMatchObject({ plainText: body, sourceVersion: 1 });
  });
  test('rejects legacy capture provenance before creating work', async () => {
    const source = await document(users[0], true);
    await saveOrganizationPreferences(users[0]!, 'MANUAL');
    await db.transcript.update({
      where: { id: source.id },
      data: { sourceMetadata: { producer: 'voxen-capture' } },
    });
    await expect(enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID())).rejects.toThrow(
      'SOURCE_PROVENANCE_UNAVAILABLE',
    );
    expect(await db.organizationRun.count({ where: { userId: users[0] } })).toBe(0);
  });
  test('rolls back a preference change if its pending-work cancellation fails', async () => {
    const source = await document();
    await saveOrganizationPreferences(users[0]!, 'MANUAL');
    const run = (await enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID()))!;
    const name = `organization_policy_fault_${randomUUID().replaceAll('-', '')}`;
    expect(users[0]).toMatch(/^[a-z0-9]+$/);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = TG_ARGV[0] AND NEW.status = 'CANCELLED' THEN RAISE EXCEPTION 'injected organization policy failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE UPDATE ON "OrganizationRun" FOR EACH ROW EXECUTE FUNCTION ${name}('${users[0]}')`,
      );
      await expect(saveOrganizationPreferences(users[0]!, 'OFF')).rejects.toThrow(
        'injected organization policy failure',
      );
      expect(await getOrganizationPreferences(users[0]!)).toEqual({
        mode: 'MANUAL',
        automaticSince: null,
      });
      expect(
        await db.organizationRun.findFirstOrThrow({ where: { id: run.id, userId: users[0] } }),
      ).toMatchObject({ status: 'PENDING', cancelRequestedAt: null });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "OrganizationRun"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
  test('rejects a source changed while its canonical object is being read', async () => {
    const source = await document();
    await saveOrganizationPreferences(users[0]!, 'MANUAL');
    const storage = await import('../src/lib/storage');
    const read = storage.storageReadText;
    let entered!: () => void, release!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = spyOn(storage, 'storageReadText').mockImplementation(async (key) => {
      entered();
      await barrier;
      return read(key);
    });
    const pending = enqueueOrganization(users[0]!, source.id, 'MANUAL', randomUUID());
    try {
      await paused;
      await db.transcript.update({ where: { id: source.id }, data: { sourceVersion: 2 } });
      release();
      await expect(pending).rejects.toThrow('STALE_SOURCE');
      expect(await db.organizationRun.count({ where: { userId: users[0] } })).toBe(0);
    } finally {
      release();
      spy.mockRestore();
      await Promise.allSettled([pending]);
    }
  });
});
