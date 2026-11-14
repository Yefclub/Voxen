import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { readPassage } from '../src/lib/passage-index/read';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('passage recovery across process termination', () => {
  test('recovers a durable orphan after SIGKILL in a fresh worker process without duplicated text', async () => {
    const owner = await db.user.create({
      data: {
        email: `passage-process-${randomUUID()}@example.test`,
        name: 'Passage process recovery',
        status: 'APPROVED',
      },
    });
    const row = await db.note.create({
      data: {
        userId: owner.id,
        title: 'Process recovery',
        content: '# Source\nA durable literal passage survives worker interruption.\n',
      },
    });
    const identity = { userId: owner.id, type: 'note', id: row.id };
    const where = {
      userId_sourceType_sourceId: { userId: owner.id, sourceType: 'note', sourceId: row.id },
    };
    const spawn = (mode: string) =>
      Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          `${import.meta.dir}/fixtures/passage-process.ts`,
          mode,
          JSON.stringify(identity),
        ],
        {
          env: { ...process.env, NODE_ENV: 'test', PASSAGE_RECOVERY_FIXTURE: '1' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
    const children: ReturnType<typeof spawn>[] = [];
    try {
      const first = spawn('claim');
      children.push(first);
      const reader = first.stdout.getReader();
      let marker = '',
        timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            while (!marker.includes('CLAIMED\n')) {
              const chunk = await reader.read();
              if (chunk.done) throw new Error('Worker exited before persisting its claim.');
              marker += new TextDecoder().decode(chunk.value);
            }
          })(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Worker claim timeout.')), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        reader.releaseLock();
      }
      expect(await db.passageIndexSource.findUniqueOrThrow({ where })).toMatchObject({
        status: 'RUNNING',
        attempt: 1,
      });
      first.kill('SIGKILL');
      expect(await first.exited).not.toBe(0);
      expect(await db.passageIndexSource.findUniqueOrThrow({ where })).toMatchObject({
        status: 'RUNNING',
        attempt: 1,
      });
      // Advance only the durable lease's expiry; this does not test real-time timer accuracy.
      await db.passageIndexSource.update({ where, data: { leaseExpiresAt: new Date(0) } });
      const restarted = spawn('execute');
      children.push(restarted);
      expect(await restarted.exited).toBe(0);
      expect(await new Response(restarted.stdout).text()).toBe('READY\n');
      const head = await db.passageIndexSource.findUniqueOrThrow({ where });
      expect(head).toMatchObject({ status: 'READY', attempt: 2, passageCount: 1 });
      const passages = await db.retrievalPassage.findMany({
        where: { userId: owner.id, sourceType: 'note', sourceId: row.id },
      });
      expect(passages).toHaveLength(1);
      expect((await readPassage(owner.id, passages[0]!.key, head.revision!)).text).toBe(
        row.content,
      );
      expect(await db.note.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    } finally {
      for (const child of children)
        if (child.exitCode === null) {
          child.kill('SIGKILL');
          await child.exited;
        }
      await db.user.delete({ where: { id: owner.id } });
    }
  }, 15_000);
});
