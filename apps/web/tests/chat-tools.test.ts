// ============================================================================
// buildTools (agente in-app) — spec 081 (ingestão de URL via chat)
// ============================================================================
// Testes leves: inspecionam a forma das tools (sem DB) + os outcomes de
// request_transcription/get_job_status com createAutoJobForUser e db.job
// mockados (mesmo padrão de tests/jobs-presign.test.ts — mock.module ANTES do
// import dinâmico do módulo real, já que import estático seria hoisted antes
// do mock ser registrado).
// ============================================================================

import { describe, expect, it, mock } from 'bun:test';
import type { AutoJobResult } from '../src/routes/jobs';

let autoJobResult: AutoJobResult = {
  outcome: 'created',
  jobId: 'job-1',
  status: 'QUEUED',
  sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
  kind: 'video',
};
let lastAutoJobArgs: { userId: string; url: string } | null = null;

mock.module('../src/routes/jobs', () => ({
  createAutoJobForUser: async (userId: string, url: string) => {
    lastAutoJobArgs = { userId, url };
    return autoJobResult;
  },
}));

type FakeJob = {
  id: string;
  status: string;
  transcriptId: string | null;
  errorMsg: string | null;
} | null;

let fakeJob: FakeJob = null;
let lastJobFindFirstArgs: unknown = null;

mock.module('../src/lib/db', () => ({
  db: {
    job: {
      findFirst: async (args: unknown) => {
        lastJobFindFirstArgs = args;
        return fakeJob;
      },
    },
  },
}));

const { buildTools } = await import('../src/lib/chat/runtime');

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

describe('request_transcription', () => {
  const tools = buildTools('user-test');

  it('outcome created retorna jobId e mensagem de acompanhamento', async () => {
    autoJobResult = {
      outcome: 'created',
      jobId: 'job-1',
      status: 'QUEUED',
      sourceUrl: 'https://youtu.be/abc',
      kind: 'video',
    };
    const result = (await runTool(tools.request_transcription, {
      url: 'https://youtu.be/abc',
    })) as { outcome: string; jobId?: string | null; message?: string };
    expect(result.outcome).toBe('created');
    expect(result.jobId).toBe('job-1');
    expect(result.message).toContain('get_job_status');
  });

  it('outcome existing_transcript retorna transcriptId (não duplica job)', async () => {
    autoJobResult = {
      outcome: 'existing_transcript',
      transcriptId: 't-1',
      kind: 'video',
      error: 'Você já transcreveu esta URL.',
    };
    const result = (await runTool(tools.request_transcription, {
      url: 'https://youtu.be/abc',
    })) as { outcome: string; transcriptId?: string | null };
    expect(result.outcome).toBe('existing_transcript');
    expect(result.transcriptId).toBe('t-1');
  });

  it('outcome inflight retorna jobId em andamento', async () => {
    autoJobResult = {
      outcome: 'inflight',
      jobId: 'job-2',
      kind: 'web',
      error: 'Esta URL já está sendo processada.',
    };
    const result = (await runTool(tools.request_transcription, {
      url: 'https://exemplo.com/artigo',
    })) as { outcome: string; jobId?: string | null };
    expect(result.outcome).toBe('inflight');
    expect(result.jobId).toBe('job-2');
  });

  it('outcome de erro (URL inválida/setup incompleto) não vaza detalhes internos', async () => {
    autoJobResult = {
      outcome: 'invalid',
      error: 'URL inválida — informe um link http(s) válido.',
    };
    const result = (await runTool(tools.request_transcription, { url: 'nao-e-url' })) as {
      outcome: string;
      error?: string;
    };
    expect(result.outcome).toBe('error');
    expect(result.error).toBe('URL inválida — informe um link http(s) válido.');
  });

  it('usa o userId do fechamento de buildTools, nunca do input', async () => {
    autoJobResult = {
      outcome: 'created',
      jobId: 'job-9',
      status: 'QUEUED',
      sourceUrl: 'https://youtu.be/z',
      kind: 'video',
    };
    const scoped = buildTools('user-xyz');
    await runTool(scoped.request_transcription, { url: 'https://youtu.be/z' });
    expect(lastAutoJobArgs?.userId).toBe('user-xyz');
    expect(lastAutoJobArgs?.url).toBe('https://youtu.be/z');
  });
});

describe('get_job_status', () => {
  const tools = buildTools('user-test');

  it('status DONE retorna transcriptId', async () => {
    fakeJob = { id: 'job-1', status: 'DONE', transcriptId: 't-1', errorMsg: null };
    const result = (await runTool(tools.get_job_status, { jobId: 'job-1' })) as {
      status: string;
      transcriptId: string | null;
    };
    expect(result.status).toBe('DONE');
    expect(result.transcriptId).toBe('t-1');
  });

  it('status FAILED retorna error', async () => {
    fakeJob = { id: 'job-1', status: 'FAILED', transcriptId: null, errorMsg: 'yt-dlp falhou.' };
    const result = (await runTool(tools.get_job_status, { jobId: 'job-1' })) as {
      status: string;
      error: string | null;
    };
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('yt-dlp falhou.');
  });

  it('status QUEUED ainda sem transcriptId/error', async () => {
    fakeJob = { id: 'job-1', status: 'QUEUED', transcriptId: null, errorMsg: null };
    const result = (await runTool(tools.get_job_status, { jobId: 'job-1' })) as {
      status: string;
      transcriptId: string | null;
      error: string | null;
    };
    expect(result.status).toBe('QUEUED');
    expect(result.transcriptId).toBe(null);
    expect(result.error).toBe(null);
  });

  it('job inexistente (ou de outro workspace) retorna erro sem vazar dados', async () => {
    fakeJob = null;
    const result = (await runTool(tools.get_job_status, { jobId: 'job-alheio' })) as {
      error?: string;
    };
    expect(result.error).toBe('Job não encontrado.');
  });

  it('escopa a consulta por userId (isolamento de workspace)', async () => {
    fakeJob = null;
    const scoped = buildTools('user-abc');
    await runTool(scoped.get_job_status, { jobId: 'job-1' });
    expect(lastJobFindFirstArgs).toMatchObject({ where: { id: 'job-1', userId: 'user-abc' } });
  });
});
