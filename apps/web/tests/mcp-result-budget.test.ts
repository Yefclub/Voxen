import { expect, test } from 'bun:test';
import { MCP_RESULT_WIRE_BYTES, budgetMcpResult } from '../src/routes/mcp-result-budget';
import { ok } from '../src/routes/mcp-tool-helpers';

const context = {
  userId: 'owner-a',
  tool: 'voxen_read_note',
  args: { note_id: 'note-id' },
  requestId: 'correlation',
};
test('large escaped/Unicode JSON results reconstruct exactly through bounded signed pages', () => {
  const data = { id: 'note-id', title: 'Big note', content: '😀"\n\\'.repeat(50_000) };
  let result = budgetMcpResult(data, context, 'READ');
  let joined = '';
  let count = 0;
  while (true) {
    expect(Buffer.byteLength(JSON.stringify(ok(result)))).toBeLessThanOrEqual(
      MCP_RESULT_WIRE_BYTES,
    );
    expect(result._mcp).toMatchObject({ truncated: true, format: 'application/json' });
    joined += result.dataChunk;
    count++;
    const metadata = result._mcp as { nextCursor: string | null };
    if (!metadata.nextCursor) break;
    result = budgetMcpResult(data, { ...context, cursor: metadata.nextCursor }, 'READ');
    if (count > 100) throw new Error('Unbounded continuation');
  }
  expect(count).toBeGreaterThan(1);
  expect(JSON.parse(joined)).toEqual(data);
});

test('content continuation is bound to the owner, tool, arguments, current result and expiry', () => {
  const data = { id: 'note-id', content: 'x'.repeat(100_000) };
  const page = budgetMcpResult(data, context, 'READ');
  const cursor = (page._mcp as { nextCursor: string }).nextCursor;
  for (const changed of [
    { ...context, userId: 'owner-b' },
    { ...context, tool: 'voxen_read_transcript' },
    { ...context, args: { note_id: 'other-id' } },
  ])
    expect(() => budgetMcpResult(data, { ...changed, cursor }, 'READ')).toThrow(
      'MCP_INVALID_CONTENT_CURSOR',
    );
  expect(() =>
    budgetMcpResult({ ...data, content: 'updated' }, { ...context, cursor }, 'READ'),
  ).toThrow('MCP_CONTENT_CHANGED');
  expect(() =>
    budgetMcpResult(data, { ...context, cursor }, 'READ', Date.now() + 6 * 60_000),
  ).toThrow('MCP_CONTENT_CURSOR_EXPIRED');
});

test('oversized write results describe a completed tool and a safe follow-up without write continuation', () => {
  const result = budgetMcpResult(
    {
      applied: true,
      correction: {
        id: 'correction-id',
        transcriptId: 'transcript-id',
        revision: 3,
        checksum: 'checksum',
        markdown: 'x'.repeat(100_000),
      },
    },
    { ...context, tool: 'voxen_patch_transcript' },
    'WRITE',
  );
  expect(Buffer.byteLength(JSON.stringify(ok(result)))).toBeLessThanOrEqual(MCP_RESULT_WIRE_BYTES);
  expect(result._mcp).toMatchObject({
    truncated: true,
    toolExecution: 'completed',
    nextCursor: null,
  });
  expect(JSON.stringify(result)).toContain('transcript-id');
  expect(JSON.stringify(result)).toContain('voxen_read_transcript_correction');
  expect(JSON.stringify(result)).not.toContain('x'.repeat(1000));
});
