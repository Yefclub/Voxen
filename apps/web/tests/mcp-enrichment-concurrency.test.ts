import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from 'mcp-legacy-test-client/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from 'mcp-legacy-test-client/client/streamableHttp.js';
import app from '../src/index';
import { db } from '../src/lib/db';
import { createMcpToken } from '../src/lib/mcp-tokens';
import { repairEnrichmentProjection } from '../src/lib/enrichment-projection';

const endpoint = new URL('/mcp', process.env.APP_BASE_URL || 'http://localhost:3000');
const localFetch = async (input: RequestInfo | URL, init?: RequestInit) =>
  app.fetch(new Request(input, init));
type Snapshot = { id: string; revision: number; checksum: string; projection: { state: string } };
describe.skipIf(!process.env.DATABASE_URL)('MCP canonical enrichment writes', () => {
  let userId = '',
    token = '';
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          name: 'MCP concurrency QA',
          email: `mcp-cas-${crypto.randomUUID()}@example.test`,
          status: 'APPROVED',
        },
      })
    ).id;
    token = (
      await createMcpToken({
        userId,
        label: 'Concurrency QA',
        scopes: ['READ', 'WRITE'],
        expiresAt: null,
      })
    ).token;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
  });
  test.each(['legacy', 'modern'] as const)(
    '%s clients receive and enforce the observed canonical contract',
    async (era) => {
      const parent = await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.test/${crypto.randomUUID()}`,
          title: 'Canonical MCP QA',
          durationSec: 0,
          language: 'en',
          transcriptionMethod: 'SCRAPE',
          mdPath: 'qa/mcp-cas.md',
          plainText: 'Original evidence',
          frontmatter: {},
        },
      });
      const row = await db.transcriptEnrichment.create({
        data: {
          userId,
          transcriptId: parent.id,
          runKey: crypto.randomUUID(),
          trigger: 'MANUAL',
          status: 'READY',
          title: 'Original evidence',
          content: 'Original cited evidence',
          sourceVersion: parent.sourceVersion,
          sourceChecksum: parent.sourceChecksum,
          citations: [
            { url: 'https://example.test/source', title: 'Source', excerpt: 'Original evidence' },
          ],
        },
      });
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const client =
        era === 'legacy'
          ? new LegacyClient({ name: 'cas-v1', version: '1' })
          : new Client({ name: 'cas-v2', version: '1' });
      const transport =
        era === 'legacy'
          ? new LegacyTransport(endpoint, { fetch: localFetch, requestInit: { headers } })
          : new StreamableHTTPClientTransport(endpoint, {
              fetch: localFetch,
              requestInit: { headers },
            });
      try {
        await client.connect(transport);
        const read = await client.callTool({
          name: 'voxen_read_transcript_enrichment',
          arguments: { enrichment_id: row.id },
        });
        expect(read.isError).not.toBe(true);
        const snapshot = (read.structuredContent as { enrichment: Snapshot }).enrichment;
        expect(snapshot.revision).toBe(1);
        expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
        const args = {
          enrichment_id: row.id,
          expected_revision: snapshot.revision,
          expected_checksum: snapshot.checksum,
        };
        const accepted = await client.callTool({
          name: 'voxen_review_transcript_enrichment',
          arguments: { ...args, action: 'accept' },
        });
        expect(accepted.isError).not.toBe(true);
        expect((accepted.structuredContent as Snapshot).projection.state).toBe('PENDING');
        const obsolete = await client.callTool({
          name: 'voxen_edit_transcript_enrichment',
          arguments: { ...args, title: 'Unseen overwrite', content: 'Wrong' },
        });
        expect(obsolete.isError).toBe(true);
        expect(JSON.stringify(obsolete)).toContain('O contexto mudou');
        const missing = await client.callTool({
          name: 'voxen_edit_transcript_enrichment',
          arguments: { enrichment_id: row.id, title: 'Missing snapshot', content: 'Wrong' },
        });
        expect(missing.isError).toBe(true);
        expect(
          (await db.transcriptEnrichment.findUniqueOrThrow({ where: { id: row.id } })).title,
        ).toBe('Original evidence');
        expect(await repairEnrichmentProjection(userId, row.id)).toBe(true);
        const synced = await client.callTool({
          name: 'voxen_read_transcript_enrichment',
          arguments: { enrichment_id: row.id },
        });
        expect(
          (synced.structuredContent as { enrichment: Snapshot }).enrichment.projection.state,
        ).toBe('SYNCED');
      } finally {
        await client.close();
      }
    },
  );
});
