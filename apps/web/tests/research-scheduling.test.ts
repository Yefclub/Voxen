import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { saveResearchPreferences } from '../src/lib/research/preferences';
import {
  scheduleCapturedResearch,
  scheduleResearchAfterCapture,
  type ResearchScheduleCursor,
} from '../src/lib/research/schedule';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
let userId: string;
suite('automatic research capture scheduling', () => {
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          email: `research-schedule-${randomUUID()}@example.test`,
          name: 'Research scheduling',
          status: 'APPROVED',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
  });
  async function source(collectedAt: Date, capture = true, createdAt = new Date()) {
    return db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/scheduling',
        title: 'Captured source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'fixture.md',
        plainText: 'A captured source is independently usable.',
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: 'source-one',
        sourceCollectedAt: collectedAt,
        sourceMetadata: capture ? { producer: 'voxen-capture', jobId: randomUUID() } : {},
        createdAt,
      },
    });
  }
  test('does no work before consent and does not backfill older or external publications', async () => {
    const old = await source(new Date(Date.now() - 60_000));
    await scheduleResearchAfterCapture(userId, old.id);
    expect(await db.transcriptEnrichment.count({ where: { userId } })).toBe(0);
    await saveResearchPreferences(userId, 'AUTO');
    const external = await source(new Date(), false);
    for (const item of [old, external]) await scheduleResearchAfterCapture(userId, item.id);
    expect(await db.transcriptEnrichment.count({ where: { userId } })).toBe(0);
  });
  test('recovers paginated captures and refreshes exactly once per revision', async () => {
    const fresh = await source(new Date());
    const refreshed = await source(new Date(), true, new Date('2020-01-01'));
    let cursor: ResearchScheduleCursor | null = null;
    do {
      ({ cursor } = await scheduleCapturedResearch(cursor, 1));
    } while (cursor);
    const jobs = await db.transcriptEnrichment.findMany({ where: { userId } });
    expect(jobs.map((job) => job.transcriptId).sort()).toEqual([fresh.id, refreshed.id].sort());
    await scheduleResearchAfterCapture(userId, fresh.id);
    expect(await db.transcriptEnrichment.count({ where: { userId } })).toBe(2);
    await db.transcript.update({
      where: { id: refreshed.id },
      data: { sourceVersion: 2, sourceChecksum: 'source-two', sourceCollectedAt: new Date() },
    });
    await scheduleResearchAfterCapture(userId, refreshed.id);
    expect(await db.transcriptEnrichment.count({ where: { transcriptId: refreshed.id } })).toBe(2);
    await saveResearchPreferences(userId, 'MANUAL');
    const manual = await source(new Date());
    await scheduleResearchAfterCapture(userId, manual.id);
    expect(await db.transcriptEnrichment.count({ where: { transcriptId: manual.id } })).toBe(0);
  });
  test('a scheduling failure leaves the capture usable and emits only a safe diagnostic', async () => {
    const captured = await source(new Date());
    const log = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(
        scheduleResearchAfterCapture(userId, captured.id, async () => {
          throw new Error('private fixture content must not enter diagnostics');
        }),
      ).resolves.toBeUndefined();
      expect(
        (await db.transcript.findUniqueOrThrow({ where: { id: captured.id } })).plainText,
      ).toBe(captured.plainText);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).toContain('RESEARCH_SCHEDULE_FAILED');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private fixture content');
    } finally {
      log.mockRestore();
    }
  });
});
