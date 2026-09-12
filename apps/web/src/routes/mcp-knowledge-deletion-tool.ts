import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  enqueueKnowledgeDeletion,
  KnowledgeDeletionConflictError,
  KnowledgeDeletionNotFoundError,
} from '../lib/knowledge-deletion';
import { fail, ok } from './mcp-tool-helpers';

export function registerMcpKnowledgeDeletionTool(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_delete_knowledge',
    {
      title: 'Excluir conteúdo da Base de conhecimento',
      description:
        'Enfileira a exclusão permanente de um conteúdo pertencente ao usuário. Antes de usar, ' +
        'localize e leia o alvo para obter o ID e o título atuais. A operação é assíncrona, ' +
        'irreversível e deve ser acompanhada com voxen_get_job_status.',
      inputSchema: {
        target_type: z.enum([
          'TRANSCRIPT',
          'NOTE',
          'SAVED_MEDIA',
          'LIBRARY_FOLDER',
          'TRANSCRIPT_ENRICHMENT',
        ]),
        target_id: z.string().min(1).max(200).describe('ID exato do conteúdo no workspace.'),
        expected_title: z
          .string()
          .min(1)
          .max(500)
          .describe('Título exato retornado pela leitura atual do conteúdo.'),
        confirm: z.literal(true).describe('Deve ser true para confirmar a exclusão irreversível.'),
      },
      outputSchema: {
        jobId: z.string(),
        status: z.string(),
        targetType: z.string(),
        targetId: z.string(),
        title: z.string(),
        reused: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Excluir conteúdo da Base de conhecimento',
      },
    },
    async (args) => {
      try {
        const result = await enqueueKnowledgeDeletion({
          userId,
          type: args.target_type,
          id: args.target_id.trim(),
          expectedTitle: args.expected_title,
        });
        return ok({
          jobId: result.job.id,
          status: result.job.status,
          targetType: result.target.type,
          targetId: result.target.id,
          title: result.target.title,
          reused: !result.created,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeDeletionConflictError ||
          error instanceof KnowledgeDeletionNotFoundError
        ) {
          return fail(error.message);
        }
        throw error;
      }
    },
  );
}
