import { expect, test } from 'bun:test';
import { z } from 'zod';
import { boundedMcpInputShape, validMcpArgumentBudget } from '../src/routes/mcp-input-budget';
import { withMcpRequest } from '../src/routes/mcp-request-body';

test('input schemas publish bounded queries and identifiers without weakening existing constraints', () => {
  const schema = z.object(
    boundedMcpInputShape({
      query: z.string().min(1),
      node_id: z.string().min(1).optional(),
      title: z.string().max(200),
      entity_ref: z.string().max(100),
    }),
  );
  const valid = { query: 'abc', title: 'Title', entity_ref: 'entity' };
  expect(schema.safeParse(valid).success).toBe(true);
  expect(schema.safeParse({ ...valid, query: 'x'.repeat(2001) }).success).toBe(false);
  expect(schema.safeParse({ ...valid, node_id: 'x'.repeat(257) }).success).toBe(false);
  expect(schema.safeParse({ ...valid, title: 'x'.repeat(201) }).success).toBe(false);
  expect(schema.safeParse({ ...valid, entity_ref: 'x'.repeat(101) }).success).toBe(false);
  const properties = z.toJSONSchema(schema).properties as Record<string, { maxLength?: number }>;
  expect(properties.query?.maxLength).toBe(2000);
  expect(properties.node_id?.maxLength).toBe(256);
  expect(properties.entity_ref?.maxLength).toBe(100);
});

test('nested identifiers and array work are bounded independently from valid large note content', () => {
  expect(
    validMcpArgumentBudget({
      content: 'x'.repeat(200_000),
      anchors: [{ transcript_id: 'owned-id' }],
    }),
  ).toBe(true);
  expect(validMcpArgumentBudget({ source_transcript_ids: ['x'.repeat(257)] })).toBe(false);
  expect(
    validMcpArgumentBudget({
      claims: Array.from({ length: 101 }, () => ({ transcript_id: 'id' })),
    }),
  ).toBe(false);
});

test('oversized RPC correlation identifiers are rejected without echoing them or entering authentication', async () => {
  let entered = false;
  const id = 'RPC_ID_PRIVATE_CANARY'.repeat(100);
  const response = await withMcpRequest(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' }),
    }),
    async () => {
      entered = true;
      return Response.json({ ok: true });
    },
  );
  expect(response.status).toBe(400);
  expect(entered).toBe(false);
  const body = await response.text();
  expect(body).not.toContain('PRIVATE_CANARY');
  expect(JSON.parse(body)).toMatchObject({ id: null, error: { code: -32600 } });
});
