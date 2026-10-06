import { expect, test } from 'bun:test';
import { withMcpReadDeadline } from '../src/routes/mcp-read-deadline';
test.skipIf(!process.env.DATABASE_URL)(
  'expensive graph reads stop in PostgreSQL within their statement budget',
  async () => {
    await expect(
      withMcpReadDeadline((tx) => tx.$queryRaw`SELECT pg_sleep(4)`),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '57014' } });
  },
  6000,
);
