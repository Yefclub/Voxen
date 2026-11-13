import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { assembleAssistantContext, WorkingMemorySchema } from '../src/lib/assistant/memory';
import {
  claimAssistantRun,
  getConversation,
  rewindConversation,
  sendAssistantMessage,
} from '../src/lib/assistant/store';

const users: string[] = [];
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
});
const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('checkpoint-linked compaction', () => {
  async function fixture() {
    const userId = (
      await db.user.create({
        data: { email: `memory-${randomUUID()}@example.test`, name: 'Memory', status: 'APPROVED' },
      })
    ).id;
    users.push(userId);
    const source = await db.assistantMessage.create({
      data: {
        userId,
        position: 1,
        role: 'user',
        text:
          'Exact decision: project Amber, version 42. ' + 'Retained source material. '.repeat(650),
      },
    });
    await db.assistantMessage.create({
      data: { userId, position: 2, role: 'assistant', text: 'Acknowledged.' },
    });
    await db.assistantConversation.create({ data: { userId, nextPosition: 3 } });
    const run = await sendAssistantMessage(userId, {
      text: 'Continue from our decision',
      requestKey: randomUUID(),
      revision: 0,
    });
    return { userId, source, run: (await claimAssistantRun(run.id))! };
  }
  test('retains exact decisions, source IDs and the latest user message without publishing memory', async () => {
    const { userId, source, run } = await fixture();
    const content = WorkingMemorySchema.parse({
      objective: 'Continue Amber',
      decisions: ['Amber version 42'],
      constraints: [],
      facts: [{ text: 'Amber version 42', sourceMessageIds: [source.id] }],
      pending: [],
      uncertainties: [],
    });
    const context = await assembleAssistantContext(
      run,
      24_000,
      new AbortController().signal,
      async () => ({
        output: content,
        modelRef: 'test',
        usage: { inputTokens: 500, outputTokens: 100 },
        costUsd: 0.001,
      }),
    );
    expect(JSON.stringify(context)).toContain('Amber version 42');
    expect(context.at(-1)?.content).toBe('Continue from our decision');
    const memory = await db.assistantMemory.findFirstOrThrow({ where: { userId } });
    expect(memory.throughPosition).toBe(2);
    expect(JSON.stringify(memory.content)).toContain(source.id);
    expect(await db.note.count({ where: { userId } })).toBe(0);
    await rewindConversation(userId, { messageId: source.id, revision: 0 });
    expect(await db.assistantMemory.count({ where: { userId } })).toBe(0);
    expect((await getConversation(userId)).messages).toHaveLength(1);
  });
  test('a compactor finishing after rewind cannot restore future memory', async () => {
    const { userId, source, run } = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = assembleAssistantContext(
      run,
      24_000,
      new AbortController().signal,
      async () => {
        entered();
        await held;
        return {
          output: WorkingMemorySchema.parse({
            objective: 'Discarded future',
            decisions: [],
            constraints: [],
            facts: [],
            pending: [],
            uncertainties: [],
          }),
          modelRef: 'test',
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
        };
      },
    );
    await started;
    await rewindConversation(userId, {
      messageId: source.id,
      revision: 0,
      text: 'Replacement intent',
      requestKey: randomUUID(),
    });
    release();
    await expect(pending).rejects.toThrow('LEASE_LOST');
    expect(await db.assistantMemory.count({ where: { userId } })).toBe(0);
    expect(JSON.stringify(await getConversation(userId))).not.toContain('Discarded future');
  });

  test('repeated compaction carries exact facts and keeps an unanswered retained user turn separate', async () => {
    const { userId, source, run } = await fixture();
    const firstMemory = WorkingMemorySchema.parse({
      objective: 'Continue Amber',
      decisions: ['Amber version 42'],
      constraints: [],
      facts: [{ text: 'Amber version 42', sourceMessageIds: [source.id] }],
      pending: [],
      uncertainties: [],
    });
    await assembleAssistantContext(run, 24_000, new AbortController().signal, async () => ({
      output: firstMemory,
      modelRef: 'test',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
    }));
    // Pruning at a user message leaves a valid unanswered turn before the next
    // request. Role alternation cannot be assumed for later memory boundaries.
    const checkpoint = await db.assistantMessage.findUniqueOrThrow({
      where: { userId_position: { userId, position: run.inputPosition } },
    });
    await rewindConversation(userId, { messageId: checkpoint.id, revision: 0 });
    await db.assistantMessage.update({
      where: { id: checkpoint.id },
      data: { text: 'Retained unanswered request. '.repeat(700) },
    });
    const next = await sendAssistantMessage(userId, {
      text: 'Current request must remain verbatim',
      requestKey: randomUUID(),
      revision: 1,
    });
    const claimed = (await claimAssistantRun(next.id))!;
    let input = '';
    const context = await assembleAssistantContext(
      claimed,
      24_000,
      new AbortController().signal,
      async (value) => {
        input = JSON.stringify(value.untrusted);
        return {
          output: firstMemory,
          modelRef: 'test',
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: 0,
        };
      },
    );
    expect(input).toContain('Amber version 42');
    expect(input).toContain(checkpoint.id);
    expect(input).not.toContain('Current request must remain verbatim');
    expect(context.at(-1)?.content).toBe('Current request must remain verbatim');
    expect(JSON.stringify(context)).toContain(source.id);
    expect(
      (
        await db.assistantMemory.findFirstOrThrow({
          where: { userId },
          orderBy: { throughPosition: 'desc' },
        })
      ).throughPosition,
    ).toBe(checkpoint.position);
  });
});
