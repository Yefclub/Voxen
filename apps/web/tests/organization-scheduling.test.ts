import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';
import { saveOrganizationPreferences } from '../src/lib/organization/preferences';
import { enqueueOrganization } from '../src/lib/organization/queue';
import {
  scheduleCapturedOrganization,
  scheduleOrganizationAfterCapture,
  type OrganizationScheduleCursor,
} from '../src/lib/organization/schedule';
import { drainOrganization } from '../src/lib/organization/runtime';

const root = mkdtempSync(join(tmpdir(), 'voxen-organization-schedule-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = root;
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const body = 'Orion is explicitly part of the Vega product family.';
let userId: string;
suite('independent organization scheduling and execution recovery', () => {
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          email: `organization-schedule-${randomUUID()}@example.test`,
          name: 'Organization scheduling',
          status: 'APPROVED',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
    rmSync(root, { recursive: true, force: true });
  });
  async function source(collectedAt: Date, capture = true) {
    const id = randomUUID(),
      mdPath = `workspaces/${userId}/${id}.md`;
    await storagePut({ key: mdPath, body, contentType: 'text/markdown' });
    return db.transcript.create({
      data: {
        id,
        userId,
        source: 'WEB',
        url: `https://example.test/${id}`,
        title: 'Captured source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath,
        plainText: body,
        frontmatter: {},
        sourceCollectedAt: collectedAt,
        sourceMetadata: capture
          ? {
              producer: 'voxen-capture',
              evidenceManifest: createSourceEvidenceManifest(body, [
                { start: 0, end: body.length },
              ]),
            }
          : {},
      },
    });
  }
  test('OFF, pre-consent and external documents do not create automatic work', async () => {
    const old = await source(new Date(Date.now() - 60_000));
    await scheduleOrganizationAfterCapture(userId, old.id);
    expect(await db.organizationRun.count({ where: { userId } })).toBe(0);
    await saveOrganizationPreferences(userId, 'AUTO');
    const external = await source(new Date(), false);
    for (const row of [old, external]) await scheduleOrganizationAfterCapture(userId, row.id);
    expect(await db.organizationRun.count({ where: { userId } })).toBe(0);
  });
  test('paginated recovery and repeated capture notifications deduplicate each source revision', async () => {
    const fresh = await source(new Date()),
      refreshed = await source(new Date());
    let cursor: OrganizationScheduleCursor | null = null,
      pages = 0;
    do {
      ({ cursor } = await scheduleCapturedOrganization(cursor, 1));
      expect(++pages).toBeLessThan(100);
    } while (cursor);
    const runs = await db.organizationRun.findMany({ where: { userId } });
    expect(runs.map((row) => row.transcriptId).sort()).toEqual([fresh.id, refreshed.id].sort());
    await scheduleOrganizationAfterCapture(userId, fresh.id);
    expect(await db.organizationRun.count({ where: { userId } })).toBe(2);
    await db.transcript.update({
      where: { id: refreshed.id },
      data: {
        sourceVersion: 2,
        sourceChecksum: 'revision-two',
        sourceCollectedAt: new Date(),
      },
    });
    await scheduleOrganizationAfterCapture(userId, refreshed.id);
    expect(await db.organizationRun.count({ where: { userId, transcriptId: refreshed.id } })).toBe(
      2,
    );
    await saveOrganizationPreferences(userId, 'MANUAL');
    const manual = await source(new Date());
    await scheduleOrganizationAfterCapture(userId, manual.id);
    expect(await db.organizationRun.count({ where: { userId, transcriptId: manual.id } })).toBe(0);
  });
  test('scheduling failure preserves published content and excludes raw error text from diagnostics', async () => {
    const captured = await source(new Date());
    const log = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(
        scheduleOrganizationAfterCapture(userId, captured.id, async () => {
          throw new Error('private capture contents');
        }),
      ).resolves.toBeUndefined();
      expect(await db.transcript.findFirstOrThrow({ where: { id: captured.id, userId } })).toEqual(
        captured,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).toContain('ORGANIZATION_SCHEDULE_FAILED');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private capture contents');
    } finally {
      log.mockRestore();
    }
  });
  test('drains due and expired current runs without dispatching future retries or retired records', async () => {
    const items = await Promise.all(Array.from({ length: 5 }, () => source(new Date(), false)));
    const runs = [];
    for (const item of items)
      runs.push((await enqueueOrganization(userId, item.id, 'MANUAL', randomUUID()))!);
    await db.organizationRun.update({
      where: { id: runs[1]!.id },
      data: {
        status: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    await db.organizationRun.update({
      where: { id: runs[2]!.id },
      data: {
        status: 'RETRY',
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });
    await db.organizationRun.update({
      where: { id: runs[3]!.id },
      data: { generationSettings: {} },
    });
    await db.organizationRun.update({
      where: { id: runs[4]!.id },
      data: {
        status: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const compilation = await db.brainCompilation.create({
      data: {
        userId,
        transcriptId: items[0]!.id,
        contentHash: 'retired',
      },
    });
    const dispatched: string[] = [];
    await drainOrganization(async (owner, id) => {
      expect(owner).toBe(userId);
      dispatched.push(id);
      return true;
    });
    expect(dispatched.sort()).toEqual([runs[0]!.id, runs[1]!.id].sort());
    expect(
      await db.brainCompilation.findFirstOrThrow({ where: { id: compilation.id, userId } }),
    ).toEqual(compilation);
  });
});
