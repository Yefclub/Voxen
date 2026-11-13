import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import {
  appendAssistantOutput,
  claimAssistantRun,
  getConversation,
  rewindConversation,
  sendAssistantMessage,
  stopAssistantRun,
} from '../src/lib/assistant/store';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('durable assistant conversation ownership', () => {
  const users: string[] = [];
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({
        data: {
          email: `assistant-${randomUUID()}@example.test`,
          name: 'Assistant test',
          status: 'APPROVED',
        },
      });
      users.push(user.id);
    }
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  test('retries share a run, competing messages conflict and other users cannot read it', async () => {
    const input = { text: 'Find my saved references', requestKey: randomUUID(), revision: 0 };
    const a = await sendAssistantMessage(users[0]!, input);
    const replay = await sendAssistantMessage(users[0]!, input);
    expect(replay.id).toBe(a.id);
    await expect(
      sendAssistantMessage(users[0]!, { ...input, requestKey: randomUUID() }),
    ).rejects.toThrow('RUN_ACTIVE');
    expect((await getConversation(users[1]!)).messages).toHaveLength(0);
    await expect(stopAssistantRun(users[1]!, a.id)).rejects.toThrow('NOT_FOUND');
    await stopAssistantRun(users[0]!, a.id);
  });

  test('stop retains partial output and fences a late worker', async () => {
    const run = await sendAssistantMessage(users[1]!, {
      text: 'Explain the library',
      requestKey: randomUUID(),
      revision: 0,
    });
    const claimed = await claimAssistantRun(run.id);
    expect(claimed).not.toBeNull();
    await appendAssistantOutput(claimed!, 'Partial answer');
    await stopAssistantRun(users[1]!, run.id);
    await expect(appendAssistantOutput(claimed!, 'Late answer')).rejects.toThrow('LEASE_LOST');
    const state = await getConversation(users[1]!);
    expect(state.messages.at(-1)?.text).toBe('Partial answer');
    expect(state.activeRun).toBeNull();
  });

  test('editing removes future messages and memory but retains publications and receipts', async () => {
    const before = await getConversation(users[0]!);
    const first = before.messages[0]!;
    await db.assistantMemory.create({
      data: {
        userId: users[0]!,
        throughPosition: 2,
        sourceDigest: 'old',
        content: { decisions: ['future fact'] },
      },
    });
    const note = await db.note.create({
      data: {
        userId: users[0]!,
        title: 'Keep this publication',
        kind: 'NOTE',
        content: 'Saved information',
      },
    });
    await db.assistantAction.create({
      data: { userId: users[0]!, key: randomUUID(), name: 'create_note', result: { id: note.id } },
    });
    const replacement = await rewindConversation(users[0]!, {
      messageId: first.id,
      revision: before.revision,
      text: 'A corrected question',
      requestKey: randomUUID(),
    });
    expect(replacement.revision).toBe(before.revision + 1);
    const state = await getConversation(users[0]!);
    expect(state.messages[0]?.text).toBe('A corrected question');
    expect(state.messages.some((message) => message.text === 'Find my saved references')).toBe(
      false,
    );
    expect(await db.assistantMemory.count({ where: { userId: users[0]! } })).toBe(0);
    expect(await db.note.count({ where: { id: note.id, userId: users[0]! } })).toBe(1);
    expect(await db.assistantAction.count({ where: { userId: users[0]! } })).toBe(1);
    await expect(
      rewindConversation(users[1]!, { messageId: first.id, revision: 0 }),
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      rewindConversation(users[0]!, { messageId: first.id, revision: before.revision }),
    ).rejects.toThrow('REVISION_CONFLICT');
  });

  test('pages retained messages in order without leaking another workspace', async () => {
    const userId = users[1]!;
    await db.assistantMessage.createMany({
      data: Array.from({ length: 45 }, (_, index) => ({
        userId,
        position: index + 10,
        role: index % 2 ? 'assistant' : 'user',
        text: `Retained turn ${index}`,
      })),
    });
    const tail = await getConversation(userId);
    expect(tail.messages).toHaveLength(40);
    expect(tail.hasMore).toBe(true);
    const earlier = await getConversation(userId, tail.messages[0]!.position);
    expect(earlier.hasMore).toBe(false);
    const positions = [...earlier.messages, ...tail.messages].map((message) => message.position);
    expect(new Set(positions).size).toBe(47);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(JSON.stringify(tail)).not.toContain('A corrected question');
  });

  test('account deactivation fences a running worker and closes queued work', async () => {
    const userId = (
      await db.user.create({
        data: {
          email: `assistant-disabled-${randomUUID()}@example.test`,
          name: 'Disabled test',
          status: 'APPROVED',
        },
      })
    ).id;
    users.push(userId);
    const run = await sendAssistantMessage(userId, {
      text: 'Pending work',
      revision: 0,
      requestKey: randomUUID(),
    });
    const claimed = (await claimAssistantRun(run.id))!;
    await db.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    await expect(appendAssistantOutput(claimed, 'Must not be written')).rejects.toThrow(
      'LEASE_LOST',
    );
    await stopAssistantRun(userId, run.id);
    const queued = await sendAssistantMessage(userId, {
      text: 'Queued before deactivation is observed',
      revision: 0,
      requestKey: randomUUID(),
    });
    expect(await claimAssistantRun(queued.id)).toBeNull();
    expect((await getConversation(userId)).activeRun).toBeNull();
    expect((await db.assistantRun.findUniqueOrThrow({ where: { id: queued.id } })).errorCode).toBe(
      'FORBIDDEN',
    );
  });
});
