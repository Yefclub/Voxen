import { tool } from 'ai';
import { z } from 'zod';
import { createAutoJobsForUser } from '../../routes/jobs';
import { matchesUrlList, type UrlIntent } from './url-intent';

export function buildBatchTranscriptionTool(
  userId: string,
  options: { emitStatus?: (label: string) => void; urlIntent?: UrlIntent },
) {
  return tool({
    description:
      'Enfileira de 1 a 20 URLs em uma única operação. Cada URL produz um job e um resultado ' +
      'independentes; use quando o usuário pedir transcrição, resumo ou organização de vários links.',
    inputSchema: z.object({ urls: z.array(z.string().min(1).max(2048)).min(1).max(20) }),
    execute: async ({ urls }) => {
      const intent = options.urlIntent;
      if (intent?.kind === 'ambiguous') {
        return {
          outcome: 'clarification-required' as const,
          error: 'O usuário enviou URLs sem informar o que deseja fazer com elas.',
        };
      }
      if (intent?.kind === 'explicit-ingest' && !matchesUrlList(intent, urls)) {
        return {
          outcome: 'error' as const,
          error: 'A lista deve conter exatamente as URLs compartilhadas neste turno.',
        };
      }
      options.emitStatus?.(`Enfileirando ${urls.length} conteúdos…`);
      const items = await createAutoJobsForUser(userId, urls);
      return {
        outcome: 'batch' as const,
        total: items.length,
        created: items.filter((item) => item.result.outcome === 'created').length,
        items: items.map((item) => ({
          index: item.index,
          url: item.input,
          outcome: item.result.outcome,
          jobId: 'jobId' in item.result ? (item.result.jobId ?? null) : null,
          transcriptId: 'transcriptId' in item.result ? (item.result.transcriptId ?? null) : null,
          error: 'error' in item.result ? item.result.error : null,
        })),
      };
    },
  });
}
