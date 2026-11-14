import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { buildAssistantTools, type AssistantReference } from '../src/lib/assistant/tools';
import { sendAssistantMessage, claimAssistantRun } from '../src/lib/assistant/store';
import { executePassageIndex } from '../src/lib/passage-index/runner';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const options = { toolCallId: 'passage-read', messages: [], context: undefined };
const users: string[] = [];
suite('assistant current passage tools', () => {
  afterEach(async () => {
    await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });
  async function fixture(indexed = true) {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `assistant-passages-${randomUUID()}@example.test`,
              name: 'Assistant passages',
              status: 'APPROVED',
            },
          })
        ).id,
      );
    const note = await db.note.create({
      data: {
        userId: users[0]!,
        title: 'Source note',
        content: '# Source\nA canonical assistant passage quotation.\n',
      },
    });
    if (indexed) await executePassageIndex({ userId: users[0]!, type: 'note', id: note.id });
    const foreign = await db.note.create({
      data: { userId: users[1]!, title: 'Private', content: 'Foreign confidential quotation.' },
    });
    await executePassageIndex({ userId: users[1]!, type: 'note', id: foreign.id });
    const run = (await claimAssistantRun(
      (
        await sendAssistantMessage(users[0]!, {
          text: 'Find the canonical assistant passage.',
          revision: 0,
          requestKey: randomUUID(),
        })
      ).id,
    ))!;
    const references = new Map<string, AssistantReference>(),
      controller = new AbortController();
    const tools = await buildAssistantTools(
      run,
      controller.signal,
      references,
      async () => undefined,
    );
    return { note, foreign, run, references, controller, tools };
  }
  test('searches then verifies a current passage and preserves source provenance and citation links', async () => {
    const f = await fixture();
    const found = (await f.tools.search_passages!.execute!(
      { query: 'canonical assistant passage', limit: 4 },
      options,
    )) as {
      results: Array<{ key: string; sourceId: string; revision: string }>;
    };
    expect(found.results.map((p) => p.sourceId)).toEqual([f.note.id]);
    expect(JSON.stringify(found)).not.toContain(f.foreign.id);
    expect(f.references.get(`/notas/${f.note.id}`)?.verified).not.toBe(true);
    const hit = found.results[0]!;
    const read = await f.tools.read_passage!.execute!(
      { key: hit.key, revision: hit.revision },
      options,
    );
    expect(read).toMatchObject({
      text: f.note.content,
      sourceType: 'note',
      kind: 'ORIGINAL',
      authority: null,
    });
    expect(f.references.get(`/notas/${f.note.id}`)).toMatchObject({
      id: f.note.id,
      verified: true,
    });
  });
  test('returns explicit stale/missing errors and prevents aborted executions from using either new tool', async () => {
    const f = await fixture();
    const found = (await f.tools.search_passages!.execute!(
      { query: 'canonical assistant passage', limit: 4 },
      options,
    )) as {
      results: Array<{ key: string; revision: string }>;
    };
    const hit = found.results[0]!;
    await db.note.update({
      where: { id: f.note.id },
      data: { content: 'An updated note.', revision: 2 },
    });
    expect(
      await f.tools.read_passage!.execute!({ key: hit.key, revision: hit.revision }, options),
    ).toEqual({ error: 'STALE_REVISION' });
    expect(
      await f.tools.read_passage!.execute!(
        { key: '0'.repeat(64), revision: hit.revision },
        options,
      ),
    ).toEqual({ error: 'NOT_FOUND' });
    expect([...f.references.values()].some((r) => r.verified)).toBe(false);
    f.controller.abort();
    await expect(
      f.tools.search_passages!.execute!({ query: 'updated note', limit: 4 }, options),
    ).rejects.toThrow('LEASE_LOST');
    await expect(
      f.tools.read_passage!.execute!({ key: hit.key, revision: hit.revision }, options),
    ).rejects.toThrow('LEASE_LOST');
  });
  test('keeps lexical discovery available during backfill without treating it as verified passage evidence', async () => {
    const f = await fixture(false);
    const result = await f.tools.search_passages!.execute!(
      { query: 'canonical assistant passage', limit: 4 },
      options,
    );
    expect(result).toMatchObject({ results: [], limitations: ['PARTIAL_INDEX'] });
    expect(JSON.stringify(result)).toContain(f.note.id);
    expect(f.references.get(`/notas/${f.note.id}`)).toMatchObject({ id: f.note.id });
    expect(f.references.get(`/notas/${f.note.id}`)?.verified).not.toBe(true);
  });
});
