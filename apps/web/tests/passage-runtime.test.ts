import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { drainPassageIndexes } from '../src/lib/passage-index/runtime';
import { executePassageIndex } from '../src/lib/passage-index/runner';
import type { PassageIdentity } from '../src/lib/passage-index/source';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('incremental passage runtime and restart discovery', () => {
  const users: string[] = [];
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `passage-runtime-${randomUUID()}@example.test`,
              name: 'Passage runtime',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.note.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function note(userId = users[0]!) {
    return db.note.create({
      data: { userId, title: 'Runtime source', content: 'A literal source passage.' },
    });
  }
  test('backfills missing ledgers and indexes bounded batches without an in-memory cursor', async () => {
    for (let i = 0; i < 20; i++) await note();
    const before = await db.note.findMany({ where: { userId: users[0]! }, orderBy: { id: 'asc' } });
    await db.passageIndexSource.deleteMany({ where: { userId: users[0]! } });
    expect(await drainPassageIndexes(executePassageIndex, users[0]!)).toBe(16);
    expect(
      await db.passageIndexSource.count({ where: { userId: users[0]!, status: 'READY' } }),
    ).toBe(16);
    expect(await drainPassageIndexes(executePassageIndex, users[0]!)).toBe(4);
    expect(await drainPassageIndexes(executePassageIndex, users[0]!)).toBe(0);
    expect(
      await db.note.findMany({ where: { userId: users[0]! }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });
  test('selects due retries and expired leases while excluding future retries, valid leases and disabled owners', async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => note()));
    for (const [index, row] of rows.entries())
      await db.passageIndexSource.update({
        where: {
          userId_sourceType_sourceId: { userId: row.userId, sourceType: 'note', sourceId: row.id },
        },
        data:
          index < 2
            ? { status: 'RETRY', nextAttemptAt: new Date(index ? Date.now() + 60_000 : 0) }
            : index < 4
              ? {
                  status: 'RUNNING',
                  leaseToken: randomUUID(),
                  leaseExpiresAt: new Date(index === 2 ? 0 : Date.now() + 60_000),
                }
              : { status: 'FAILED' },
      });
    await note(users[1]);
    await db.user.update({ where: { id: users[1]! }, data: { status: 'DISABLED' } });
    expect(await drainPassageIndexes(executePassageIndex, users[1]!)).toBe(0);
    const selected: PassageIdentity[] = [];
    await drainPassageIndexes(async (identity) => {
      selected.push(identity);
      return executePassageIndex(identity);
    }, users[0]!);
    expect(selected.map((s) => s.id).sort()).toEqual([rows[0]!.id, rows[2]!.id].sort());
    await db.user.update({ where: { id: users[1]! }, data: { status: 'APPROVED' } });
  });
  test('holds the process drain until its current executions settle and prevents overlapping batches', async () => {
    await note();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = drainPassageIndexes(async (identity) => {
      started();
      await gate;
      return executePassageIndex(identity);
    }, users[0]!);
    await entered;
    expect(await drainPassageIndexes(executePassageIndex, users[0]!)).toBe(0);
    release();
    expect(await first).toBe(1);
    expect(await drainPassageIndexes(executePassageIndex, users[0]!)).toBe(0);
  });
});
