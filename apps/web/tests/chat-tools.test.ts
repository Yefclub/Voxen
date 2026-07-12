// ============================================================================
// buildTools (agente in-app) — spec 081 (ingestão de URL via chat)
// ============================================================================
// Testes leves (sem DB): inspecionam a forma das tools. Os outcomes de
// request_transcription/get_job_status são testados com Postgres real
// (describeIfDb), mesmo padrão de tests/jobs.test.ts e tests/mcp.test.ts.
//
// NÃO usar mock.module('../src/routes/jobs', ...) / mock.module('../src/lib/db', ...)
// aqui: no Bun, mock.module() substitui o módulo pro processo INTEIRO de
// `bun test`, não só para este arquivo. Uma versão anterior deste arquivo
// mockava esses dois módulos com um subconjunto de exports — no CI (Linux),
// isso rodava antes de outras suítes carregarem routes/jobs.ts (esperando
// createUploadJobForUser, ausente no mock) e lib/db.ts (esperando db.user/
// costEvent/transcript/..., ausentes no stub), quebrando qr-login.test.ts,
// library.test.ts, jobs-presign.test.ts, share-target.test.ts e
// chat-single-session.test.ts inteiros. Localmente (sem DATABASE_URL) esses
// blocos DB-gated nem rodavam, escondendo o vazamento — daí a suíte completa
// local passar mesmo com o bug real presente. Ver tests/jobs-presign.test.ts
// para um mock.module seguro: ele substitui TODOS os exports de um módulo
// pequeno e autocontido (lib/s3.ts), então não há export "esquecido" para
// quebrar outro consumidor.
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { buildTools } from '../src/lib/chat/runtime';
import { db } from '../src/lib/db';
import { deleteSetting, setSetting } from '../src/lib/settings';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

type ExecutableTool = {
  execute: (input: unknown, options: { toolCallId: string; messages: unknown[] }) => unknown;
};

async function runTool(t: unknown, input: unknown): Promise<unknown> {
  const { execute } = t as ExecutableTool;
  return execute(input, { toolCallId: 'test-call', messages: [] });
}

describe('buildTools (agente in-app)', () => {
  const tools = buildTools('user-test');
  const names = Object.keys(tools);

  it('expõe as ferramentas do fluxo progressivo', () => {
    for (const name of [
      'search_transcripts',
      'outline_transcript',
      'read_lines',
      'read_section',
      'read_timespan',
      'expand_context',
      'related',
      'verify_citations',
      'read_transcript',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('mantém as ferramentas de notas e Brain', () => {
    for (const name of ['search_notes', 'read_note', 'brain_search', 'propose_create_note']) {
      expect(names).toContain(name);
    }
  });

  it('expõe as ferramentas de ingestão de URL', () => {
    for (const name of ['request_transcription', 'get_job_status']) {
      expect(names).toContain(name);
    }
  });

  it('cada ferramenta tem inputSchema e execute', () => {
    for (const name of names) {
      const t = tools[name as keyof typeof tools] as {
        inputSchema?: unknown;
        execute?: unknown;
      };
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.execute).toBe('function');
    }
  });
});

describeIfDb('request_transcription (com DB)', () => {
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `chat-tools-req-${Date.now()}@voxen.local`,
        name: 'Chat Tools Test',
        status: 'APPROVED',
      },
      select: { id: true },
    });
    userId = user.id;
    await setSetting('openrouter_api_key', 'sk-or-v1-' + 'x'.repeat(40));
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { userId } });
    await db.transcript.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => {});
    await deleteSetting('openrouter_api_key').catch(() => {});
  });

  it('outcome created enfileira job novo', async () => {
    const tools = buildTools(userId);
    const result = (await runTool(tools.request_transcription, {
      url: 'https://www.youtube.com/watch?v=chatTool001',
    })) as { outcome: 'created'; jobId: string; message: string };
    expect(result.outcome).toBe('created');
    expect(typeof result.jobId).toBe('string');
    expect(result.message).toContain('get_job_status');
    const job = await db.job.findUnique({ where: { id: result.jobId } });
    expect(job?.userId).toBe(userId);
    expect(job?.status).toBe('QUEUED');
    expect(job?.sourceUrl).toBe('https://youtu.be/chatTool001');
  });

  it('outcome existing_transcript aponta a transcrição existente (não duplica job)', async () => {
    const existing = await db.transcript.create({
      data: {
        userId,
        source: 'YOUTUBE',
        url: 'https://youtu.be/chatTool002',
        title: 'Já transcrito',
        durationSec: 60,
        language: 'pt',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `workspaces/${userId}/transcripts/chatTool002.md`,
        plainText: 'corpo',
        frontmatter: {},
      },
      select: { id: true },
    });
    const tools = buildTools(userId);
    const result = (await runTool(tools.request_transcription, {
      url: 'https://www.youtube.com/watch?v=chatTool002',
    })) as { outcome: 'existing_transcript'; transcriptId: string; message: string };
    expect(result.outcome).toBe('existing_transcript');
    expect(result.transcriptId).toBe(existing.id);
    const jobCount = await db.job.count({
      where: { userId, sourceUrl: 'https://youtu.be/chatTool002' },
    });
    expect(jobCount).toBe(0);
  });

  it('outcome inflight quando a URL já está em processamento', async () => {
    const inflight = await db.job.create({
      data: {
        userId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'QUEUED',
        sourceUrl: 'https://youtu.be/chatTool003',
      },
      select: { id: true },
    });
    const tools = buildTools(userId);
    const result = (await runTool(tools.request_transcription, {
      url: 'https://www.youtube.com/watch?v=chatTool003',
    })) as { outcome: 'inflight'; jobId: string | null; message: string };
    expect(result.outcome).toBe('inflight');
    expect(result.jobId).toBe(inflight.id);
  });

  it('outcome error para URL inválida (sem detalhes internos)', async () => {
    const tools = buildTools(userId);
    const result = (await runTool(tools.request_transcription, {
      url: 'nao-e-uma-url-valida',
    })) as { outcome: 'error'; error: string };
    expect(result.outcome).toBe('error');
    expect(result.error).toBe('URL inválida — informe um link http(s) válido.');
  });

  it('usa o userId do fechamento de buildTools, nunca do input (isolamento)', async () => {
    const other = await db.user.create({
      data: {
        email: `chat-tools-req-other-${Date.now()}@voxen.local`,
        name: 'Other',
        status: 'APPROVED',
      },
      select: { id: true },
    });
    try {
      const tools = buildTools(other.id);
      const result = (await runTool(tools.request_transcription, {
        url: 'https://www.youtube.com/watch?v=chatTool004',
      })) as { outcome: 'created'; jobId: string; message: string };
      expect(result.outcome).toBe('created');
      const job = await db.job.findUnique({ where: { id: result.jobId } });
      expect(job?.userId).toBe(other.id);
      expect(job?.userId).not.toBe(userId);
    } finally {
      await db.job.deleteMany({ where: { userId: other.id } });
      await db.user.delete({ where: { id: other.id } }).catch(() => {});
    }
  });
});

describeIfDb('get_job_status (com DB)', () => {
  let userId = '';
  let otherId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `chat-tools-status-${Date.now()}@voxen.local`,
        name: 'Chat Tools Status Test',
        status: 'APPROVED',
      },
      select: { id: true },
    });
    userId = user.id;
    const other = await db.user.create({
      data: {
        email: `chat-tools-status-other-${Date.now()}@voxen.local`,
        name: 'Other',
        status: 'APPROVED',
      },
      select: { id: true },
    });
    otherId = other.id;
  });

  afterAll(async () => {
    await db.job.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await db.transcript.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it('status DONE retorna transcriptId', async () => {
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'YOUTUBE',
        url: 'https://youtu.be/chatTool005',
        title: 'Concluído',
        durationSec: 60,
        language: 'pt',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `workspaces/${userId}/transcripts/chatTool005.md`,
        plainText: 'corpo',
        frontmatter: {},
      },
      select: { id: true },
    });
    const job = await db.job.create({
      data: {
        userId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'DONE',
        sourceUrl: 'https://youtu.be/chatTool005',
        transcriptId: transcript.id,
      },
      select: { id: true },
    });
    const tools = buildTools(userId);
    const result = (await runTool(tools.get_job_status, { jobId: job.id })) as {
      status: string;
      transcriptId: string | null;
    };
    expect(result.status).toBe('DONE');
    expect(result.transcriptId).toBe(transcript.id);
  });

  it('status FAILED retorna error', async () => {
    const job = await db.job.create({
      data: {
        userId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'FAILED',
        sourceUrl: 'https://youtu.be/chatTool006',
        errorMsg: 'yt-dlp falhou.',
      },
      select: { id: true },
    });
    const tools = buildTools(userId);
    const result = (await runTool(tools.get_job_status, { jobId: job.id })) as {
      status: string;
      error: string | null;
    };
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('yt-dlp falhou.');
  });

  it('status QUEUED ainda sem transcriptId/error', async () => {
    const job = await db.job.create({
      data: {
        userId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'QUEUED',
        sourceUrl: 'https://youtu.be/chatTool007',
      },
      select: { id: true },
    });
    const tools = buildTools(userId);
    const result = (await runTool(tools.get_job_status, { jobId: job.id })) as {
      status: string;
      transcriptId: string | null;
      error: string | null;
    };
    expect(result.status).toBe('QUEUED');
    expect(result.transcriptId).toBe(null);
    expect(result.error).toBe(null);
  });

  it('job inexistente retorna erro genérico', async () => {
    const tools = buildTools(userId);
    const result = (await runTool(tools.get_job_status, { jobId: 'job-inexistente' })) as {
      error?: string;
    };
    expect(result.error).toBe('Job não encontrado.');
  });

  it('job de outro usuário retorna "não encontrado" (isolamento de workspace)', async () => {
    const alheio = await db.job.create({
      data: {
        userId: otherId,
        type: 'DOWNLOAD_AND_TRANSCRIBE',
        status: 'DONE',
        sourceUrl: 'https://youtu.be/chatTool008',
      },
      select: { id: true },
    });
    const tools = buildTools(userId); // usuário DIFERENTE do dono do job
    const result = (await runTool(tools.get_job_status, { jobId: alheio.id })) as {
      error?: string;
      status?: string;
    };
    expect(result.error).toBe('Job não encontrado.');
    expect(result.status).toBeUndefined();
  });
});
