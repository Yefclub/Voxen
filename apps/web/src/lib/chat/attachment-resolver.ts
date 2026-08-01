// ============================================================================
// Resolução server-side dos anexos de uma mensagem (spec 126)
// ----------------------------------------------------------------------------
// Fronteira de workspace. O cliente manda apenas IDS de job; nome e tipo vêm
// SEMPRE do job resolvido com escopo `userId` da sessão. Um id de outro
// workspace não é encontrado e some do vínculo, em vez de vazar nome de
// arquivo alheio (CLAUDE.md § Isolamento de Workspaces).
//
// Por que este módulo existe separado de `message-attachments.ts`: aquele é
// puro (roda também no cliente) e não pode importar Prisma. Este é o pedaço
// que fala com o banco.
//
// Por que a busca é INJETÁVEL (`findJobs`): sem isso, o filtro por `userId`
// ficava coberto apenas por um `toContain` no texto-fonte da rota — um grep,
// não um teste. Reescrever a query sem o `userId` passava na suíte inteira.
// Com a injeção, `tests/chat-message-attachments.test.ts` chama a função com
// um finder que emula o Postgres e afirma o COMPORTAMENTO: job de outro
// usuário não vira anexo, e o `where` emitido carrega o `userId`.
// ============================================================================

import { db } from '../db';
import { detectUploadKind, parseUploadSourceUrl } from '../media-upload';
import { buildMessageAttachments, type MessageAttachment } from './message-attachments';

/** Job de upload reduzido ao que o vínculo do anexo precisa. */
export interface AttachmentJobRow {
  id: string;
  sourceUrl: string;
}

/**
 * Consulta emitida pela resolução. O `userId` é obrigatório no tipo — remover
 * o escopo quebra o typecheck, além de quebrar o teste de comportamento.
 */
export interface AttachmentJobQuery {
  where: { id: { in: string[] }; userId: string };
  select: { id: true; sourceUrl: true };
}

export type AttachmentJobFinder = (query: AttachmentJobQuery) => Promise<AttachmentJobRow[]>;

const findAttachmentJobs: AttachmentJobFinder = (query) => db.job.findMany(query);

/**
 * Resolve os jobs de upload informados pelo cliente para anexos exibíveis.
 * Ids sem correspondência no workspace do usuário somem do vínculo — a
 * mensagem segue sem anexo fantasma.
 */
export async function resolveAttachments(
  userId: string,
  jobIds: readonly string[] | undefined,
  findJobs: AttachmentJobFinder = findAttachmentJobs,
): Promise<MessageAttachment[]> {
  if (!jobIds?.length) return [];
  const jobs = await findJobs({
    where: { id: { in: [...jobIds] }, userId },
    select: { id: true, sourceUrl: true },
  });
  const resolved: MessageAttachment[] = [];
  for (const job of jobs) {
    const parsed = parseUploadSourceUrl(job.sourceUrl);
    if (!parsed) continue;
    const kind = detectUploadKind(parsed.filename, '');
    if (!kind) continue;
    resolved.push({ jobId: job.id, name: parsed.filename, kind });
  }
  return buildMessageAttachments(jobIds, resolved);
}
