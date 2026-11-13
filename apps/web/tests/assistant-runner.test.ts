import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import { db } from '../src/lib/db';
import { setUserSetting } from '../src/lib/settings';
import {
  sendAssistantMessage,
  getConversation,
  claimAssistantRun,
  rewindConversation,
} from '../src/lib/assistant/store';
import { executeAssistantRun, drainAssistantRuns } from '../src/lib/assistant/runner';
import { buildAssistantTools } from '../src/lib/assistant/tools';
import type { IntentClassifier } from '../src/lib/assistant/additions';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const usage = {
  inputTokens: { total: 200, noCache: 200, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 100, text: 100, reasoning: undefined },
};
const intent: IntentClassifier = async (_userId, request) => ({
  output: { notes: true, captures: false, evidence: request },
  usage: { inputTokens: 10, outputTokens: 10 },
  costUsd: 0,
  modelRef: 'test-intent',
});
suite('assistant execution through the real AI SDK loop', () => {
  let userId = '';
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          email: `assistant-runtime-${randomUUID()}@example.test`,
          name: 'Runtime',
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
  });
  afterAll(async () => {
    await db.user.delete({ where: { id: userId } });
  });
  const send = () =>
    sendAssistantMessage(userId, {
      text: 'Save a short note',
      requestKey: randomUUID(),
      revision: 0,
    });

  test('persists streamed output and completes independently of an HTTP connection', async () => {
    const run = await send();
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'text-start', id: 'a' });
            c.enqueue({ type: 'text-delta', id: 'a', delta: 'A retained answer.' });
            c.enqueue({ type: 'text-end', id: 'a' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
            c.close();
          },
        }),
      }),
    });
    await executeAssistantRun(run.id, { model: () => model, intent });
    const state = await getConversation(userId);
    expect(state.messages.at(-1)?.text).toBe('A retained answer.');
    expect(state.activeRun).toBeNull();
    expect((await db.assistantRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'DONE',
    );
    expect(
      await db.assistantEvent.count({ where: { userId, runId: run.id, kind: 'text' } }),
    ).toBeGreaterThan(0);
  });

  test('duplicate write calls use a durable receipt and publish one note', async () => {
    const run = await send();
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            if (step++ === 0) {
              for (const toolCallId of ['save-1', 'save-2'])
                c.enqueue({
                  type: 'tool-call',
                  toolCallId,
                  toolName: 'create_note',
                  input: JSON.stringify({
                    title: 'Unique assistant publication',
                    content: 'Verified note content',
                  }),
                });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage,
              });
            } else {
              c.enqueue({ type: 'text-start', id: 'b' });
              c.enqueue({ type: 'text-delta', id: 'b', delta: 'Saved your note.' });
              c.enqueue({ type: 'text-end', id: 'b' });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage,
              });
            }
            c.close();
          },
        }),
      }),
    });
    await executeAssistantRun(run.id, { model: () => model, intent });
    expect(await db.note.count({ where: { userId, title: 'Unique assistant publication' } })).toBe(
      1,
    );
    expect(await db.assistantAction.count({ where: { userId, name: 'create_note' } })).toBe(1);
    expect((await getConversation(userId)).messages.at(-1)?.text).toBe('Saved your note.');
    expect((await getConversation(userId)).messages.at(-1)?.details.actions).toHaveLength(1);
  });

  test('all turns offer addition tools but stale tools cannot run after rewind', async () => {
    const run = await send();
    const claimed = await claimAssistantRun(run.id);
    const tools = await buildAssistantTools(
      claimed!,
      new AbortController().signal,
      new Map(),
      async () => undefined,
    );
    expect(tools.create_note?.execute).toBeFunction();
    expect(tools.capture_url?.execute).toBeFunction();
    const state = await getConversation(userId);
    await rewindConversation(userId, {
      revision: state.revision,
      messageId: state.messages.at(-2)!.id,
    });
    await expect(
      tools.search_history!.execute!(
        { query: 'retained' },
        { toolCallId: 'late', messages: [], context: undefined },
      ),
    ).rejects.toThrow('LEASE_LOST');
  });

  test('restart recovery preserves partial output and does not replay effects', async () => {
    const state = await getConversation(userId);
    const run = await sendAssistantMessage(userId, {
      text: 'Continue',
      requestKey: randomUUID(),
      revision: state.revision,
    });
    await claimAssistantRun(run.id);
    await db.assistantMessage.update({
      where: { id: run.outputMessageId },
      data: { text: 'Partial before restart' },
    });
    await db.assistantRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await drainAssistantRuns();
    const recovered = await getConversation(userId);
    expect(recovered.activeRun).toBeNull();
    expect(recovered.messages.at(-1)?.text).toBe('Partial before restart');
    expect(recovered.messages.at(-1)?.details).toMatchObject({ error: 'INTERRUPTED' });
    expect(await db.assistantAction.count({ where: { userId, name: 'create_note' } })).toBe(1);
  });
});
