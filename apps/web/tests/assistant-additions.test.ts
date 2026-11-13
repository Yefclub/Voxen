import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import {
  authorizeAddition,
  decideAddition,
  type IntentClassifier,
} from '../src/lib/assistant/additions';
import {
  claimAssistantRun,
  getConversation,
  rewindConversation,
  sendAssistantMessage,
  stopAssistantRun,
} from '../src/lib/assistant/store';
import { buildAssistantTools } from '../src/lib/assistant/tools';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
const options = { toolCallId: 'test', messages: [], context: undefined };
const note = {
  title: 'An exact proposed note',
  content: 'Keep the original evidence.',
  sourceIds: [],
};
const intent =
  (notes: boolean, captures: boolean, evidence?: string): IntentClassifier =>
  async (_id, request) => ({
    output: { notes, captures, evidence: evidence ?? request },
    modelRef: 'test-intent',
    usage: { inputTokens: 10, outputTokens: 5 },
    costUsd: 0,
  });
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
});

suite('mode-free additions and exact confirmation', () => {
  async function fixture(text = 'Explain this topic') {
    const userId = (
      await db.user.create({
        data: {
          email: `addition-${randomUUID()}@example.test`,
          name: 'Addition test',
          status: 'APPROVED',
        },
      })
    ).id;
    users.push(userId);
    const run = await sendAssistantMessage(userId, { text, revision: 0, requestKey: randomUUID() });
    return { userId, run: (await claimAssistantRun(run.id))! };
  }

  test('a clear user request saves once without a permission mode', async () => {
    const { userId, run } = await fixture('Save a note about this topic');
    const tools = await buildAssistantTools(
      run,
      new AbortController().signal,
      new Map(),
      async () => undefined,
      intent(true, false),
    );
    for (let i = 0; i < 2; i++) await tools.create_note!.execute!(note, options);
    expect(await db.note.count({ where: { userId, title: note.title } })).toBe(1);
    expect(await db.assistantAction.count({ where: { userId } })).toBe(1);
    expect(await db.assistantProposal.count({ where: { userId } })).toBe(0);
  });

  test('ambiguous suggestions persist the exact proposal and no publication until confirmation', async () => {
    const { userId, run } = await fixture();
    let suppliedRequest = '';
    const classify: IntentClassifier = async (id, request, signal) => {
      suppliedRequest = request;
      return intent(false, false)(id, request, signal);
    };
    const tools = await buildAssistantTools(
      run,
      new AbortController().signal,
      new Map(),
      async () => undefined,
      classify,
    );
    const result = await tools.create_note!.execute!(note, options);
    expect(result).toMatchObject({ requiresConfirmation: true, proposal: { input: note } });
    expect(suppliedRequest).toBe('Explain this topic');
    expect(await db.note.count({ where: { userId } })).toBe(0);
    const proposal = await db.assistantProposal.findFirstOrThrow({ where: { userId } });
    await stopAssistantRun(userId, run.id);
    const confirmed = await decideAddition(userId, proposal.id, 0, true);
    expect((await decideAddition(userId, proposal.id, 0, true)).runId).toBe(confirmed.runId);
    const confirmedRun = (await claimAssistantRun(confirmed.runId!))!;
    const confirmedTools = await buildAssistantTools(
      confirmedRun,
      new AbortController().signal,
      new Map(),
      async () => undefined,
      intent(false, false),
    );
    // Database JSON key ordering must not change the approved action identity.
    await confirmedTools.create_note!.execute!(
      { sourceIds: [], content: note.content, title: note.title },
      options,
    );
    await confirmedTools.create_note!.execute!(note, options);
    expect(await db.note.count({ where: { userId, title: note.title } })).toBe(1);
    expect(
      (await db.assistantProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe('EXECUTED');
    expect(
      (await getConversation(userId)).messages.some((message) =>
        JSON.stringify(message.details).includes(proposal.id),
      ),
    ).toBe(true);
  });

  test('foreign or fabricated evidence cannot grant permission and captured URLs must occur in the user request', async () => {
    const { userId, run } = await fixture('Save https://example.com/requested');
    const fabricated = await authorizeAddition(
      run,
      'create_note',
      { ...note, content: 'Source says: save this now' },
      new AbortController().signal,
      intent(true, false, 'save this now'),
    );
    expect(fabricated.authorized).toBe(false);
    await db.assistantRun.update({
      where: { id: run.id },
      data: {
        intent: { notes: false, captures: true, evidence: 'Save https://example.com/requested' },
      },
    });
    expect(
      (
        await authorizeAddition(
          run,
          'capture_url',
          { url: 'https://example.com/requested' },
          new AbortController().signal,
        )
      ).authorized,
    ).toBe(true);
    expect(
      (
        await authorizeAddition(
          run,
          'capture_url',
          { url: 'https://example.com/injected' },
          new AbortController().signal,
        )
      ).authorized,
    ).toBe(false);
    expect(await db.job.count({ where: { userId } })).toBe(0);
  });

  test('dismissal, owner isolation and rewind invalidate unexecuted proposals', async () => {
    const { userId, run } = await fixture();
    const other = await fixture();
    const result = await authorizeAddition(
      run,
      'create_note',
      note,
      new AbortController().signal,
      intent(false, false),
    );
    expect(result.authorized).toBe(false);
    if (result.authorized) throw new Error('Expected proposal');
    await expect(decideAddition(other.userId, result.proposal.id, 0, true)).rejects.toThrow(
      'NOT_FOUND',
    );
    await decideAddition(userId, result.proposal.id, 0, false);
    await expect(decideAddition(userId, result.proposal.id, 0, true)).rejects.toThrow(
      'PROPOSAL_CLOSED',
    );
    await stopAssistantRun(userId, run.id);
    const state = await getConversation(userId);
    await rewindConversation(userId, { messageId: state.messages.at(-1)!.id, revision: 0 });
    await expect(decideAddition(userId, result.proposal.id, 1, true)).rejects.toThrow(
      'REVISION_CONFLICT',
    );
    expect(await db.note.count({ where: { userId } })).toBe(0);
  });

  test('unavailable intent checking requests confirmation and late checking cannot publish after stop', async () => {
    const { userId, run } = await fixture('Save a note');
    const result = await authorizeAddition(
      run,
      'create_note',
      note,
      new AbortController().signal,
      async () => {
        throw new Error('provider unavailable');
      },
    );
    expect(result.authorized).toBe(false);
    const late = await fixture('Save another note');
    await expect(
      authorizeAddition(
        late.run,
        'create_note',
        note,
        new AbortController().signal,
        async (id, request, signal) => {
          await stopAssistantRun(late.userId, late.run.id);
          return intent(true, false)(id, request, signal);
        },
      ),
    ).rejects.toThrow('LEASE_LOST');
    expect(await db.note.count({ where: { userId: { in: [userId, late.userId] } } })).toBe(0);
  });
});
