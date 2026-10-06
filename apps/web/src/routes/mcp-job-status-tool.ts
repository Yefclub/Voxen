import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { db } from '../lib/db';
import { getTranscriptBrief } from '../lib/agent-content';
import { TRANSCRIPT_BRIEF_SCHEMA } from './mcp-transcription-schemas';
import { fail, ok } from './mcp-tool-helpers';

export function registerMcpJobStatusTool(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_get_job_status',
    {
      title: 'Status de um job',
      description:
        'Consulta o status de um job de transcrição/indexação: QUEUED, RUNNING, DONE, FAILED ' +
        'ou CANCELLED. Quando DONE, retorna transcript_id e um brief read-only com resumo, tags e ' +
        'relacionados já armazenados; quando FAILED, retorna o erro.',
      inputSchema: {
        job_id: z.string().min(1).describe('ID do job retornado por request_transcription.'),
      },
      outputSchema: {
        id: z.string(),
        status: z.string(),
        transcriptId: z.string().nullable(),
        error: z.string().nullable(),
        brief: TRANSCRIPT_BRIEF_SCHEMA.nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Status de um job',
      },
    },
    async (args) => {
      const job = await db.job.findFirst({
        where: { id: args.job_id.trim(), userId },
        select: { id: true, status: true, transcriptId: true, errorMsg: true },
      });
      if (!job) return fail('Job não encontrado.');
      const brief =
        (job.status === 'DONE' || job.status === 'COMPLETED_WITH_WARNINGS') && job.transcriptId
          ? await getTranscriptBrief(userId, job.transcriptId, { enrichMissing: false })
          : null;
      return ok({
        id: job.id,
        status: job.status,
        transcriptId: job.transcriptId ?? null,
        error: job.errorMsg ?? null,
        brief,
      });
    },
  );
}
