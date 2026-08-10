import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { deleteSetting, setSetting } from '../src/lib/settings';
import {
  transcriptCorrectionChecksum,
  transcriptMarkdownToPlainText,
} from '../src/lib/transcript-corrections';

async function call(body: unknown, token = ''): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /mcp (auth)', () => {
  it('rejeita request sem Authorization', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
  });

  it('rejeita token inválido', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'token-errado');
    expect(res.status).toBe(401);
  });

  it('rejeita Origin divergente (defesa DNS rebinding)', async () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://voxen.example.com';
    try {
      const res = await app.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            origin: 'https://evil.example.com',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      );
      expect(res.status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prev;
    }
  });
});

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describeIfDb('MCP Streamable HTTP (com DB)', () => {
  const TOKEN = 'test-mcp-token-' + 'z'.repeat(24);
  const READ_TOKEN = 'test-mcp-read-' + 'r'.repeat(24);
  const WRITE_TOKEN = 'test-mcp-write-' + 'w'.repeat(24);
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `mcp-test-${Date.now()}@voxen.local`, name: 'MCP Test', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Teste MCP', scopes: 'READ,WRITE' },
    });
    await db.mcpToken.createMany({
      data: [
        { userId, tokenHash: hashMcpToken(READ_TOKEN), label: 'Read MCP', scopes: 'READ' },
        { userId, tokenHash: hashMcpToken(WRITE_TOKEN), label: 'Write MCP', scopes: 'WRITE' },
      ],
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('initialize negocia protocolo e devolve serverInfo', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { serverInfo?: { name?: string; version?: string }; instructions?: string };
    };
    expect(data.result?.serverInfo?.name).toBe('voxen-mcp');
    expect(data.result?.serverInfo?.version).toBe('0.4.0');
    expect(data.result?.instructions).toContain('tags e resumo');
    expect(data.result?.instructions).toContain('source_anchors');
    expect(data.result?.instructions).toContain('DADOS NÃO CONFIÁVEIS');
  });

  it('tools/list expõe tools voxen_ com readOnlyHint', async () => {
    const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, TOKEN);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const tools = data.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain('voxen_search_knowledge');
    expect(names).toContain('voxen_search_transcripts');
    expect(names).toContain('voxen_read_transcript');
    expect(names).toContain('voxen_brain_search');
    expect(names).toContain('voxen_list_transcript_enrichments');
    expect(names).toContain('voxen_read_transcript_enrichment');
    const search = tools.find((t) => t.name === 'voxen_search_transcripts');
    expect(search?.annotations?.readOnlyHint).toBe(true);
  });

  it('recusa token expirado', async () => {
    const expired = 'expired-mcp-token-' + crypto.randomUUID();
    await db.mcpToken.create({
      data: {
        userId,
        tokenHash: hashMcpToken(expired),
        label: 'Expirado',
        scopes: 'READ',
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    const res = await call({ jsonrpc: '2.0', id: 22, method: 'tools/list' }, expired);
    expect(res.status).toBe(401);
  });

  it('tools/call voxen_list_transcripts retorna lista vazia escopada', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'voxen_list_transcripts', arguments: {} },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { structuredContent?: { transcripts?: unknown[]; nextCursor?: string | null } };
    };
    expect(Array.isArray(data.result?.structuredContent?.transcripts)).toBe(true);
    expect(data.result?.structuredContent?.transcripts?.length).toBe(0);
    expect(data.result?.structuredContent?.nextCursor).toBe(null);
  });

  it('voxen_search_knowledge reúne toda a base e valida contexto externo aceito', async () => {
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: `https://example.com/mcp-buzz-${Date.now()}`,
        title: 'Vídeo MCP sobre Buzz',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/mcp-buzz.md`,
        plainText: 'O Buzz tem um repositório oficial.',
        frontmatter: {},
      },
    });
    await db.transcriptEnrichment.create({
      data: {
        userId,
        transcriptId: transcript.id,
        runKey: `mcp-search-${Date.now()}`,
        trigger: 'MANUAL',
        status: 'READY',
        reviewState: 'ACCEPTED',
        title: 'Contexto externo revisado sobre Buzz',
        content: 'O repositório Buzz mantém documentação oficial revisada.',
        sourceVersion: transcript.sourceVersion,
        sourceChecksum: transcript.sourceChecksum,
      },
    });
    await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Buzz — links oficiais',
        content: 'Repositório: github.com/block/buzz',
      },
    });

    const res = await call(
      {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: { name: 'voxen_search_knowledge', arguments: { query: 'Buzz repositório' } },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { structuredContent?: { results?: { sourceType: string; href: string }[] } };
    };
    const results = data.result?.structuredContent?.results ?? [];
    expect(results.map((result) => result.sourceType)).toEqual(
      expect.arrayContaining(['note', 'transcript', 'external_enrichment']),
    );
    expect(results.find((result) => result.sourceType === 'note')?.href).toMatch(
      /^http:\/\/localhost\/notas\//u,
    );
  });

  it('tools/call em transcript inexistente retorna isError (não erro de protocolo)', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'voxen_read_transcript', arguments: { transcript_id: 'nao-existe' } },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { isError?: boolean } };
    expect(data.result?.isError).toBe(true);
  });

  it('tools/list inclui as write tools com readOnlyHint false', async () => {
    const res = await call({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, TOKEN);
    const data = (await res.json()) as {
      result?: { tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const tools = data.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain('voxen_create_note');
    expect(names).toContain('voxen_update_note');
    expect(names).toContain('voxen_patch_note');
    expect(names).toContain('voxen_restore_note_revision');
    expect(names).toContain('voxen_search_note_content');
    expect(names).toContain('voxen_list_note_revisions');
    expect(names).toContain('voxen_read_note_revision');
    expect(names).toContain('voxen_request_transcription');
    expect(names).toContain('voxen_request_transcriptions');
    expect(names).toContain('voxen_get_job_status');
    expect(names).toContain('voxen_request_transcript_research');
    expect(names).toContain('voxen_review_transcript_enrichment');
    expect(names).toContain('voxen_edit_transcript_enrichment');
    expect(names).toContain('voxen_delete_transcript_enrichment');
    expect(names).toContain('voxen_delete_knowledge');
    const createNote = tools.find((t) => t.name === 'voxen_create_note');
    expect(createNote?.annotations?.readOnlyHint).toBe(false);
  });

  it('voxen_request_transcriptions devolve um resultado independente por URL', async () => {
    await setSetting('openrouter_api_key', 'sk-or-v1-' + 'm'.repeat(40));
    try {
      const res = await call(
        {
          jsonrpc: '2.0',
          id: 53,
          method: 'tools/call',
          params: {
            name: 'voxen_request_transcriptions',
            arguments: {
              urls: [
                'https://www.youtube.com/watch?v=mcpBatch001',
                'inválida',
                'https://youtu.be/mcpBatch001',
              ],
            },
          },
        },
        WRITE_TOKEN,
      );
      const body = (await res.json()) as {
        result?: {
          structuredContent?: {
            total: number;
            created: number;
            items: Array<{ outcome: string; jobId: string | null }>;
          };
        };
      };
      const batch = body.result?.structuredContent;
      expect(batch?.total).toBe(3);
      expect(batch?.created).toBe(1);
      expect(batch?.items.map((item) => item.outcome)).toEqual(['created', 'invalid', 'inflight']);
      expect(batch?.items[2]?.jobId).toBe(batch?.items[0]?.jobId);
    } finally {
      await db.job.deleteMany({ where: { userId, sourceUrl: 'https://youtu.be/mcpBatch001' } });
      await deleteSetting('openrouter_api_key').catch(() => {});
    }
  });

  it('expõe somente as tools autorizadas por tokens READ ou WRITE', async () => {
    const readResponse = await call({ jsonrpc: '2.0', id: 51, method: 'tools/list' }, READ_TOKEN);
    const readBody = (await readResponse.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const readNames = (readBody.result?.tools ?? []).map((tool) => tool.name);
    expect(readNames).toContain('voxen_read_transcript');
    expect(readNames).toContain('voxen_read_transcript_enrichment');
    expect(readNames).toContain('voxen_search_transcript_content');
    expect(readNames).toContain('voxen_list_transcript_corrections');
    expect(readNames).not.toContain('voxen_create_note');
    expect(readNames).not.toContain('voxen_review_transcript_enrichment');
    expect(readNames).not.toContain('voxen_patch_transcript');

    const writeResponse = await call({ jsonrpc: '2.0', id: 52, method: 'tools/list' }, WRITE_TOKEN);
    const writeBody = (await writeResponse.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const writeNames = (writeBody.result?.tools ?? []).map((tool) => tool.name);
    expect(writeNames).toContain('voxen_create_note');
    expect(writeNames).toContain('voxen_review_transcript_enrichment');
    expect(writeNames).toContain('voxen_patch_transcript');
    expect(writeNames).toContain('voxen_restore_transcript_correction');
    expect(writeNames).toContain('voxen_delete_knowledge');
    expect(writeNames).not.toContain('voxen_read_transcript');
    expect(writeNames).not.toContain('voxen_read_transcript_enrichment');
    expect(writeNames).not.toContain('voxen_search_transcript_content');
  });

  it('voxen_delete_knowledge exige confirmação exata e apenas enfileira a exclusão', async () => {
    const otherUser = await db.user.create({
      data: {
        email: `mcp-delete-isolation-${Date.now()}@voxen.local`,
        name: 'Other workspace',
        status: 'APPROVED',
      },
    });
    const note = await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Delete me through MCP',
        content: 'This row must remain until the worker claims the deletion job.',
      },
    });
    const foreignNote = await db.note.create({
      data: {
        userId: otherUser.id,
        kind: 'NOTE',
        title: 'Foreign note',
        content: 'Must never be visible or deletable through another workspace token.',
      },
    });
    try {
      const foreignAttempt = await call(
        {
          jsonrpc: '2.0',
          id: 53,
          method: 'tools/call',
          params: {
            name: 'voxen_delete_knowledge',
            arguments: {
              target_type: 'NOTE',
              target_id: foreignNote.id,
              expected_title: foreignNote.title,
              confirm: true,
            },
          },
        },
        WRITE_TOKEN,
      );
      const foreignBody = (await foreignAttempt.json()) as {
        result?: { isError?: boolean };
      };
      expect(foreignBody.result?.isError).toBe(true);
      expect(await db.job.count({ where: { userId, deletionTargetId: foreignNote.id } })).toBe(0);

      const staleConfirmation = await call(
        {
          jsonrpc: '2.0',
          id: 54,
          method: 'tools/call',
          params: {
            name: 'voxen_delete_knowledge',
            arguments: {
              target_type: 'NOTE',
              target_id: note.id,
              expected_title: 'Wrong title',
              confirm: true,
            },
          },
        },
        WRITE_TOKEN,
      );
      const staleBody = (await staleConfirmation.json()) as {
        result?: { isError?: boolean };
      };
      expect(staleBody.result?.isError).toBe(true);
      expect(await db.job.count({ where: { userId, deletionTargetId: note.id } })).toBe(0);

      const accepted = await call(
        {
          jsonrpc: '2.0',
          id: 55,
          method: 'tools/call',
          params: {
            name: 'voxen_delete_knowledge',
            arguments: {
              target_type: 'NOTE',
              target_id: note.id,
              expected_title: note.title,
              confirm: true,
            },
          },
        },
        WRITE_TOKEN,
      );
      const acceptedBody = (await accepted.json()) as {
        result?: {
          structuredContent?: { jobId?: string; status?: string; reused?: boolean };
        };
      };
      const deletion = acceptedBody.result?.structuredContent;
      expect(deletion).toMatchObject({ status: 'QUEUED', reused: false });
      expect(await db.note.findFirst({ where: { id: note.id, userId } })).not.toBeNull();
      const job = await db.job.findFirstOrThrow({
        where: { id: deletion?.jobId, userId },
      });
      expect(job).toMatchObject({
        type: 'DELETE_KNOWLEDGE',
        deletionTargetType: 'NOTE',
        deletionTargetId: note.id,
        deletionTargetTitle: note.title,
      });

      const duplicate = await call(
        {
          jsonrpc: '2.0',
          id: 56,
          method: 'tools/call',
          params: {
            name: 'voxen_delete_knowledge',
            arguments: {
              target_type: 'NOTE',
              target_id: note.id,
              expected_title: note.title,
              confirm: true,
            },
          },
        },
        WRITE_TOKEN,
      );
      const duplicateBody = (await duplicate.json()) as {
        result?: { structuredContent?: { jobId?: string; reused?: boolean } };
      };
      expect(duplicateBody.result?.structuredContent).toMatchObject({
        jobId: job.id,
        reused: true,
      });
    } finally {
      await db.job.deleteMany({ where: { userId, deletionTargetId: note.id } });
      await db.note.deleteMany({ where: { id: note.id, userId } });
      await db.user.delete({ where: { id: otherUser.id } });
    }
  });

  it('tools/call voxen_create_note cria a nota escopada por userId', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'voxen_create_note', arguments: { title: 'Nota MCP', content: '# oi' } },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { structuredContent?: { id?: string } } };
    const noteId = data.result?.structuredContent?.id;
    expect(typeof noteId).toBe('string');
    const note = await db.note.findFirst({ where: { id: noteId, userId } });
    expect(note?.title).toBe('Nota MCP');
    expect(note?.userId).toBe(userId);
  });

  it('voxen_create_note persiste e voxen_read_note devolve fontes de transcrição', async () => {
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: `https://example.com/mcp-source-${Date.now()}`,
        title: 'Fonte MCP',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/mcp-source.md`,
        plainText: 'Fonte de uma nota MCP.',
        frontmatter: {},
      },
    });
    const create = await call(
      {
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: {
          name: 'voxen_create_note',
          arguments: {
            title: 'Nota com fonte MCP',
            source_transcript_ids: [transcript.id],
            source_anchors: [
              {
                transcript_id: transcript.id,
                start_line: 3,
                end_line: 3,
                selected_quote: 'Fonte de uma nota MCP.',
              },
            ],
          },
        },
      },
      TOKEN,
    );
    const created = (await create.json()) as { result?: { structuredContent?: { id?: string } } };
    const noteId = created.result?.structuredContent?.id;
    expect(typeof noteId).toBe('string');
    const stored = await db.noteTranscriptSource.findUnique({
      where: { noteId_transcriptId: { noteId: noteId!, transcriptId: transcript.id } },
    });
    expect(stored?.userId).toBe(userId);

    const read = await call(
      {
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/call',
        params: { name: 'voxen_read_note', arguments: { note_id: noteId } },
      },
      TOKEN,
    );
    const readBody = (await read.json()) as {
      result?: {
        structuredContent?: {
          href?: string;
          sources?: { href: string; anchors: { selectedQuote: string; href: string }[] }[];
        };
      };
    };
    expect(readBody.result?.structuredContent?.href).toBe(`http://localhost/notas/${noteId}`);
    expect(readBody.result?.structuredContent?.sources?.[0]?.href).toBe(
      `http://localhost/transcricoes/${transcript.id}`,
    );
    expect(readBody.result?.structuredContent?.sources?.[0]?.anchors).toEqual([
      expect.objectContaining({
        selectedQuote: 'Fonte de uma nota MCP.',
        href: `http://localhost/transcricoes/${transcript.id}#l=3-3`,
      }),
    ]);

    const invalid = await call(
      {
        jsonrpc: '2.0',
        id: 43,
        method: 'tools/call',
        params: {
          name: 'voxen_create_note',
          arguments: { title: 'Fonte inválida MCP', source_transcript_ids: ['   '] },
        },
      },
      TOKEN,
    );
    const invalidBody = (await invalid.json()) as { result?: { isError?: boolean } };
    expect(invalidBody.result?.isError).toBe(true);
  });

  it('voxen_update_note não edita nota de outro user (isolamento)', async () => {
    const other = await db.user.create({
      data: { email: `mcp-other-${Date.now()}@voxen.local`, name: 'Other', status: 'APPROVED' },
    });
    const otherNote = await db.note.create({
      data: { userId: other.id, kind: 'NOTE', title: 'Alheia', content: 'segredo' },
      select: { id: true },
    });
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'voxen_update_note',
          arguments: { note_id: otherNote.id, content: 'hackeado' },
        },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { isError?: boolean } };
    expect(data.result?.isError).toBe(true);
    const unchanged = await db.note.findUnique({ where: { id: otherNote.id } });
    expect(unchanged?.content).toBe('segredo');
  });

  it('faz busca cirúrgica, preview, edição versionada, conflito e restore', async () => {
    const create = await call(
      {
        jsonrpc: '2.0',
        id: 70,
        method: 'tools/call',
        params: {
          name: 'voxen_create_note',
          arguments: { title: 'Versionada MCP', content: 'Alpha\nTarget\nOmega' },
        },
      },
      TOKEN,
    );
    const created = (await create.json()) as {
      result?: { structuredContent?: { id?: string; revision?: number } };
    };
    const noteId = created.result?.structuredContent?.id;
    expect(typeof noteId).toBe('string');
    expect(created.result?.structuredContent?.revision).toBe(1);

    const search = await call(
      {
        jsonrpc: '2.0',
        id: 71,
        method: 'tools/call',
        params: {
          name: 'voxen_search_note_content',
          arguments: { note_id: noteId, query: 'target' },
        },
      },
      TOKEN,
    );
    const searched = (await search.json()) as {
      result?: { structuredContent?: { revision?: number; matches?: Array<{ line: number }> } };
    };
    expect(searched.result?.structuredContent?.revision).toBe(1);
    expect(searched.result?.structuredContent?.matches?.[0]?.line).toBe(2);

    const operation = { kind: 'replace', target: 'Target', text: 'Revised' };
    const preview = await call(
      {
        jsonrpc: '2.0',
        id: 72,
        method: 'tools/call',
        params: {
          name: 'voxen_patch_note',
          arguments: { note_id: noteId, expected_revision: 1, operation, preview_only: true },
        },
      },
      TOKEN,
    );
    const previewed = (await preview.json()) as {
      result?: { structuredContent?: { applied?: boolean; revision?: number } };
    };
    expect(previewed.result?.structuredContent).toMatchObject({ applied: false, revision: 1 });
    expect((await db.note.findUniqueOrThrow({ where: { id: noteId! } })).revision).toBe(1);

    const apply = await call(
      {
        jsonrpc: '2.0',
        id: 73,
        method: 'tools/call',
        params: {
          name: 'voxen_patch_note',
          arguments: { note_id: noteId, expected_revision: 1, operation, preview_only: false },
        },
      },
      TOKEN,
    );
    const applied = (await apply.json()) as {
      result?: { structuredContent?: { applied?: boolean; revision?: number } };
    };
    expect(applied.result?.structuredContent).toMatchObject({ applied: true, revision: 2 });

    const stale = await call(
      {
        jsonrpc: '2.0',
        id: 74,
        method: 'tools/call',
        params: {
          name: 'voxen_patch_note',
          arguments: {
            note_id: noteId,
            expected_revision: 1,
            operation: { kind: 'append', text: ' stale' },
            preview_only: false,
          },
        },
      },
      TOKEN,
    );
    const staleBody = (await stale.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(staleBody.result?.isError).toBe(true);
    expect(staleBody.result?.content?.[0]?.text).toContain('REVISION_CONFLICT');

    const history = await call(
      {
        jsonrpc: '2.0',
        id: 75,
        method: 'tools/call',
        params: { name: 'voxen_list_note_revisions', arguments: { note_id: noteId } },
      },
      TOKEN,
    );
    const revisions = (await history.json()) as {
      result?: {
        structuredContent?: {
          revisions?: Array<{ revision: number }>;
          nextBefore?: number | null;
        };
      };
    };
    expect(revisions.result?.structuredContent?.revisions?.map((item) => item.revision)).toEqual([
      2, 1,
    ]);
    expect(revisions.result?.structuredContent?.nextBefore).toBeNull();

    const firstHistoryPage = await call(
      {
        jsonrpc: '2.0',
        id: 751,
        method: 'tools/call',
        params: {
          name: 'voxen_list_note_revisions',
          arguments: { note_id: noteId, limit: 1 },
        },
      },
      TOKEN,
    );
    const firstHistoryBody = (await firstHistoryPage.json()) as {
      result?: {
        structuredContent?: {
          revisions?: Array<{ revision: number }>;
          nextBefore?: number | null;
        };
      };
    };
    expect(firstHistoryBody.result?.structuredContent).toMatchObject({
      revisions: [{ revision: 2 }],
      nextBefore: 2,
    });

    const olderHistoryPage = await call(
      {
        jsonrpc: '2.0',
        id: 752,
        method: 'tools/call',
        params: {
          name: 'voxen_list_note_revisions',
          arguments: { note_id: noteId, limit: 1, before_revision: 2 },
        },
      },
      TOKEN,
    );
    const olderHistoryBody = (await olderHistoryPage.json()) as {
      result?: { structuredContent?: { revisions?: Array<{ revision: number }> } };
    };
    expect(olderHistoryBody.result?.structuredContent?.revisions).toMatchObject([{ revision: 1 }]);

    const restore = await call(
      {
        jsonrpc: '2.0',
        id: 76,
        method: 'tools/call',
        params: {
          name: 'voxen_restore_note_revision',
          arguments: { note_id: noteId, revision: 1, expected_revision: 2 },
        },
      },
      TOKEN,
    );
    const restored = (await restore.json()) as {
      result?: { structuredContent?: { revision?: number; restoredFromRevision?: number } };
    };
    expect(restored.result?.structuredContent).toMatchObject({
      revision: 3,
      restoredFromRevision: 1,
    });
  });

  it('corrige uma transcrição por revisão sem sobrescrever a evidência canônica', async () => {
    const canonicalPlainText = 'wrong phrase in canonical evidence';
    const baseMarkdown = '# Transcript\n\n[00:00:01] wrong phrase in canonical evidence';
    const basePlainText = transcriptMarkdownToPlainText(baseMarkdown);
    const baseChecksum = transcriptCorrectionChecksum(baseMarkdown, basePlainText);
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'YOUTUBE',
        url: `https://example.com/mcp-correction-${Date.now()}`,
        title: 'Transcript correction MCP',
        durationSec: 3,
        language: 'en',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `workspaces/${userId}/transcripts/mcp-correction.md`,
        plainText: canonicalPlainText,
        frontmatter: {},
        correctionRevision: 1,
        correctedMarkdown: baseMarkdown,
        correctedPlainText: basePlainText,
        correctedChecksum: baseChecksum,
        correctionSourceVersion: 0,
        correctionSourceChecksum: null,
        correctionRevisions: {
          create: {
            userId,
            revision: 1,
            sourceVersion: 0,
            sourceChecksum: null,
            markdown: baseMarkdown,
            plainText: basePlainText,
            checksum: baseChecksum,
            actor: 'USER',
            changeSummary: 'Initial reviewed correction',
          },
        },
      },
    });

    const search = await call(
      {
        jsonrpc: '2.0',
        id: 80,
        method: 'tools/call',
        params: {
          name: 'voxen_search_transcript_content',
          arguments: { transcript_id: transcript.id, query: 'wrong phrase' },
        },
      },
      TOKEN,
    );
    const searched = (await search.json()) as {
      result?: {
        structuredContent?: {
          revision?: number;
          checksum?: string;
          sourceVersion?: number;
          sourceChecksum?: string | null;
          matches?: Array<{ line: number }>;
        };
      };
    };
    expect(searched.result?.structuredContent).toMatchObject({
      revision: 1,
      checksum: baseChecksum,
      sourceVersion: 0,
      sourceChecksum: null,
      matches: [{ line: 3 }],
    });

    const operation = { kind: 'replace', target: 'wrong phrase', text: 'correct phrase' };
    const preview = await call(
      {
        jsonrpc: '2.0',
        id: 81,
        method: 'tools/call',
        params: {
          name: 'voxen_patch_transcript',
          arguments: {
            transcript_id: transcript.id,
            expected_revision: 1,
            expected_source_version: 0,
            expected_source_checksum: null,
            expected_checksum: baseChecksum,
            operation,
            preview_only: true,
          },
        },
      },
      TOKEN,
    );
    const previewed = (await preview.json()) as {
      result?: { structuredContent?: { applied?: boolean; resultChecksum?: string } };
    };
    const resultChecksum = previewed.result?.structuredContent?.resultChecksum;
    expect(previewed.result?.structuredContent?.applied).toBe(false);
    expect(resultChecksum).toMatch(/^[a-f0-9]{64}$/);

    const apply = await call(
      {
        jsonrpc: '2.0',
        id: 82,
        method: 'tools/call',
        params: {
          name: 'voxen_patch_transcript',
          arguments: {
            transcript_id: transcript.id,
            expected_revision: 1,
            expected_source_version: 0,
            expected_source_checksum: null,
            expected_checksum: baseChecksum,
            expected_result_checksum: resultChecksum,
            operation,
            preview_only: false,
          },
        },
      },
      TOKEN,
    );
    const applied = (await apply.json()) as {
      result?: {
        structuredContent?: { applied?: boolean; correction?: { revision?: number } };
      };
    };
    expect(applied.result?.structuredContent).toMatchObject({
      applied: true,
      correction: { revision: 2 },
    });
    const stored = await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } });
    expect(stored.plainText).toBe(canonicalPlainText);
    expect(stored.correctedPlainText).toContain('correct phrase');
  });
});
