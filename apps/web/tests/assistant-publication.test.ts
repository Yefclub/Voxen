import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { setUserSetting } from '../src/lib/settings';
import { buildAssistantTools } from '../src/lib/assistant/tools';
import {
  claimAssistantRun,
  getConversation,
  sendAssistantMessage,
} from '../src/lib/assistant/store';
import { drainAssistantRuns } from '../src/lib/assistant/runner';
import type { IntentClassifier } from '../src/lib/assistant/additions';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
let userId: string | undefined;
afterAll(async () => {
  if (userId) await db.user.delete({ where: { id: userId } });
});
suite('atomic assistant publications', () => {
  test('rolls back effects when receipt persistence fails and recovers receipts after a post-commit crash', async () => {
    userId = (
      await db.user.create({
        data: {
          email: `assistant-atomic-${randomUUID()}@example.test`,
          name: 'Atomic test',
          status: 'APPROVED',
        },
      })
    ).id;
    await setUserSetting(userId, 'ai_provider_key:anthropic', 'test-key-not-a-real-credential');
    await setUserSetting(
      userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    const url = `https://example.com/atomic-${randomUUID()}`;
    const created = await sendAssistantMessage(userId, {
      text: `Save a note and capture ${url}`,
      revision: 0,
      requestKey: randomUUID(),
    });
    const run = (await claimAssistantRun(created.id))!;
    const classify: IntentClassifier = async (_id, request) => ({
      output: { notes: true, captures: true, evidence: request },
      modelRef: 'test-intent',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
    });
    const options = { toolCallId: 'atomic-test', messages: [], context: undefined };
    const suffix = randomUUID().replaceAll('-', '');
    const name = `assistant_receipt_fault_${suffix}`;
    // These identifiers and the trigger argument are generated fixture data,
    // never request input. DDL cannot bind identifiers as query parameters.
    expect(userId).toMatch(/^[a-z0-9]+$/);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = TG_ARGV[0] THEN RAISE EXCEPTION 'injected assistant receipt failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON "AssistantAction" FOR EACH ROW EXECUTE FUNCTION ${name}('${userId}')`,
      );
      const tools = await buildAssistantTools(
        run,
        new AbortController().signal,
        new Map(),
        async () => undefined,
        classify,
      );
      expect(
        await tools.create_note!.execute!(
          { title: 'Atomic retained note', content: 'One committed publication.', sourceIds: [] },
          options,
        ),
      ).toMatchObject({ error: 'TOOL_FAILED' });
      expect(await tools.capture_url!.execute!({ url }, options)).toMatchObject({
        error: 'TOOL_FAILED',
      });
      expect(await db.note.count({ where: { userId } })).toBe(0);
      expect(await db.job.count({ where: { userId } })).toBe(0);
      expect(await db.assistantAction.count({ where: { userId } })).toBe(0);
      expect(await db.preparedIngestKey.count({ where: { userId } })).toBe(0);
      await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "AssistantAction"`);
      const crash = await buildAssistantTools(
        run,
        new AbortController().signal,
        new Map(),
        async () => {
          throw new Error('simulated post-commit process failure');
        },
        classify,
      );
      await crash.create_note!.execute!(
        { title: 'Atomic retained note', content: 'One committed publication.', sourceIds: [] },
        options,
      );
      await crash.capture_url!.execute!({ url }, options);
      expect(await db.note.count({ where: { userId } })).toBe(1);
      expect(await db.job.count({ where: { userId } })).toBe(1);
      expect(await db.assistantAction.count({ where: { userId } })).toBe(2);
      expect(await db.preparedIngestKey.count({ where: { userId } })).toBe(1);
      await db.assistantRun.update({
        where: { id: run.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });
      await drainAssistantRuns();
      const recovered = await getConversation(userId);
      const note = await db.note.findFirstOrThrow({ where: { userId } });
      const job = await db.job.findFirstOrThrow({ where: { userId } });
      expect(recovered.messages.at(-1)?.details.actions).toHaveLength(2);
      expect(JSON.stringify(recovered.messages.at(-1)?.details)).toContain(`/notas/${note.id}`);
      expect(JSON.stringify(recovered.messages.at(-1)?.details)).toContain(job.id);
      expect(recovered.activeRun).toBeNull();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "AssistantAction"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
  });
});
