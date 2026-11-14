import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { saveOrganizationPreferences } from '../src/lib/organization/preferences';
import { enqueueOrganization } from '../src/lib/organization/queue';
import {
  assertOrganizationLease,
  claimOrganization,
  renewOrganizationLease,
  withOrganizationLease,
} from '../src/lib/organization/lease';

const root = mkdtempSync(join(tmpdir(), 'voxen-organization-lease-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('organization execution lease and publication fencing', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `organization-lease-${randomUUID()}@example.test`,
              name: 'Organization lease',
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
  async function queued(userId = users[0]!) {
    await saveOrganizationPreferences(userId, 'MANUAL');
    const id = randomUUID(),
      text = 'Orion is explicitly part of the Vega product family.';
    const mdPath = `workspaces/${userId}/transcripts/${id}/source.md`;
    await storagePut({ key: mdPath, body: text, contentType: 'text/markdown' });
    const source = await db.transcript.create({
      data: {
        id,
        userId,
        title: 'Lease source',
        source: 'WEB',
        url: `https://example.test/${id}`,
        language: 'en',
        durationSec: 0,
        transcriptionMethod: 'SCRAPE',
        frontmatter: {},
        mdPath,
        plainText: text,
        sourceVersion: 1,
        sourceChecksum: 'one',
      },
    });
    return { source, run: (await enqueueOrganization(userId, id, 'MANUAL', randomUUID()))! };
  }
  test('allows only one current execution across owners', async () => {
    const one = await queued(),
      two = await queued(users[1]);
    const claims = await Promise.all([
      claimOrganization(users[0]!, one.run.id),
      claimOrganization(users[1]!, two.run.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims.find((row) => row !== null)!;
    await expect(
      renewOrganizationLease({
        ...winner,
        userId: winner.userId === users[0] ? users[1]! : users[0]!,
      }),
    ).rejects.toThrow('LEASE_LOST');
    expect(
      await db.organizationRun.count({ where: { userId: { in: users }, status: 'RUNNING' } }),
    ).toBe(1);
  });
  test('expired leases cannot be renewed and replacement claims retain the first start time', async () => {
    const fixture = await queued();
    const first = (await claimOrganization(users[0]!, fixture.run.id, 'same-owner-token'))!;
    await db.organizationRun.updateMany({
      where: { id: first.id, userId: users[0] },
      data: { leaseExpiresAt: new Date(0) },
    });
    await expect(renewOrganizationLease(first)).rejects.toThrow('LEASE_LOST');
    const second = (await claimOrganization(users[0]!, fixture.run.id, 'same-owner-token'))!;
    expect(second.attempt).toBe(first.attempt + 1);
    expect(second.startedAt).toEqual(first.startedAt);
    await expect(withOrganizationLease(first, async () => undefined)).rejects.toThrow('LEASE_LOST');
    await expect(renewOrganizationLease(second)).resolves.toBeUndefined();
  });
  test('consent changes fence active callbacks without affecting the original source', async () => {
    const fixture = await queued();
    const run = (await claimOrganization(users[0]!, fixture.run.id))!;
    await saveOrganizationPreferences(users[0]!, 'OFF');
    let invoked = false;
    await expect(
      withOrganizationLease(run, async () => {
        invoked = true;
      }),
    ).rejects.toThrow('LEASE_LOST');
    await expect(renewOrganizationLease(run)).rejects.toThrow('LEASE_LOST');
    expect(invoked).toBe(false);
    expect(
      await db.transcript.findFirstOrThrow({ where: { id: fixture.source.id, userId: users[0] } }),
    ).toMatchObject({ plainText: fixture.source.plainText, sourceVersion: 1 });
  });
  test('changed source snapshots prevent publication and cancel a reclaimed execution', async () => {
    const fixture = await queued();
    const run = (await claimOrganization(users[0]!, fixture.run.id))!;
    await db.transcript.update({
      where: { id: fixture.source.id },
      data: {
        correctionRevision: 1,
        correctedMarkdown: 'A correction changes the effective evidence.',
        correctedChecksum: 'corrected',
      },
    });
    await expect(withOrganizationLease(run, async () => undefined)).rejects.toThrow('LEASE_LOST');
    await db.organizationRun.updateMany({
      where: { id: run.id, userId: users[0] },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect(await claimOrganization(users[0]!, run.id)).toBeNull();
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'CANCELLED', lastError: 'SOURCE_CHANGED' });
  });
  test('an interrupted section receipt commits before a replacement can reclaim the execution', async () => {
    const fixture = await queued();
    const first = (await claimOrganization(users[0]!, fixture.run.id))!;
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publication = withOrganizationLease(first, async (tx) => {
      await tx.organizationSection.updateMany({
        where: { runId: first.id, run: { userId: users[0] } },
        data: { status: 'COMPLETED', reason: 'Committed section receipt', nodeCount: 2 },
      });
      await tx.organizationRun.updateMany({
        where: { id: first.id, userId: users[0] },
        data: { completedSections: 1 },
      });
      entered();
      await barrier;
      await assertOrganizationLease(tx, first);
    });
    let replacement: ReturnType<typeof claimOrganization> | undefined;
    try {
      await held;
      replacement = claimOrganization(
        users[0]!,
        first.id,
        'replacement-owner',
        new Date(Date.now() + 120_000),
      );
      release();
      await publication;
      const second = (await replacement)!;
      expect(second.leaseOwner).toBe('replacement-owner');
      expect(second.completedSections).toBe(1);
      expect(
        await db.organizationSection.findFirstOrThrow({
          where: { runId: first.id, run: { userId: users[0] } },
        }),
      ).toMatchObject({ status: 'COMPLETED', nodeCount: 2, reason: 'Committed section receipt' });
      await expect(withOrganizationLease(first, async () => undefined)).rejects.toThrow(
        'LEASE_LOST',
      );
    } finally {
      release();
      await Promise.allSettled([publication, ...(replacement ? [replacement] : [])]);
    }
  });
  test('does not restart the fifteen-minute execution deadline after a retry', async () => {
    const fixture = await queued();
    await db.organizationRun.updateMany({
      where: { id: fixture.run.id, userId: users[0] },
      data: { status: 'RETRY', startedAt: new Date(Date.now() - 16 * 60_000) },
    });
    expect(await claimOrganization(users[0]!, fixture.run.id)).toBeNull();
    expect(
      await db.organizationRun.findFirstOrThrow({
        where: { id: fixture.run.id, userId: users[0] },
      }),
    ).toMatchObject({ status: 'FAILED', lastError: 'TIMEOUT', leaseOwner: null });
  });
  test('marks cost unknown after reclaiming a provider call without a confirmed receipt', async () => {
    const fixture = await queued();
    const first = (await claimOrganization(users[0]!, fixture.run.id))!;
    await db.organizationSection.updateMany({
      where: { runId: first.id, run: { userId: users[0] } },
      data: { status: 'RUNNING', attempts: 1, callPending: true },
    });
    await db.organizationRun.updateMany({
      where: { id: first.id, userId: users[0] },
      data: { costUsd: 0.004, leaseExpiresAt: new Date(0) },
    });
    const recovered = (await claimOrganization(users[0]!, first.id))!;
    expect(recovered.costUsd).toBeNull();
    expect(recovered.warnings).toContain('UNCONFIRMED_USAGE');
    expect(
      await db.organizationSection.findFirstOrThrow({
        where: { runId: first.id, run: { userId: users[0] } },
      }),
    ).toMatchObject({ attempts: 1, callPending: true });
  });
  test('allows the current owner to finish its run and prevents later renewal', async () => {
    const fixture = await queued();
    const run = (await claimOrganization(users[0]!, fixture.run.id))!;
    await withOrganizationLease(run, async (tx) => {
      await tx.organizationRun.updateMany({
        where: { id: run.id, userId: users[0] },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
    expect(
      await db.organizationRun.findFirstOrThrow({ where: { id: run.id, userId: users[0] } }),
    ).toMatchObject({ status: 'COMPLETED', leaseOwner: null });
    await expect(renewOrganizationLease(run)).rejects.toThrow('LEASE_LOST');
  });
  test('retains unknown usage when an interrupted provider call is recovered after its deadline', async () => {
    const fixture = await queued();
    const run = (await claimOrganization(users[0]!, fixture.run.id))!;
    await db.organizationSection.updateMany({
      where: { runId: run.id, run: { userId: users[0] } },
      data: { status: 'RUNNING', attempts: 1, callPending: true },
    });
    await db.organizationRun.updateMany({
      where: { id: run.id, userId: users[0] },
      data: {
        costUsd: 0,
        startedAt: new Date(Date.now() - 16 * 60_000),
        leaseExpiresAt: new Date(0),
      },
    });
    expect(await claimOrganization(users[0]!, run.id)).toBeNull();
    const failed = await db.organizationRun.findFirstOrThrow({
      where: { id: run.id, userId: users[0] },
    });
    expect(failed).toMatchObject({ status: 'FAILED', lastError: 'TIMEOUT', costUsd: null });
    expect(failed.warnings).toContain('UNCONFIRMED_USAGE');
  });
});
