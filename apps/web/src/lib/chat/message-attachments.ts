// ============================================================================
// Anexos vinculados à mensagem do usuário (spec 126)
// ----------------------------------------------------------------------------
// O anexo do composer sempre foi um upload independente para a Base de conhecimento (job de
// ingestão) e nada ligava aquele arquivo à mensagem enviada: depois do reload
// o usuário perdia o rastro do que mandou. Agora a mensagem do usuário guarda
// um vínculo leve (`{jobId, name, kind}`) em `ChatMessage.attachments`.
//
// Regras de confiança: o cliente só manda IDS de job. Nome e tipo vêm SEMPRE
// do job resolvido no servidor com escopo `userId` — nunca do payload. Este
// módulo é puro (sem Prisma/S3/DOM) para rodar no servidor e no cliente.
// ============================================================================

export type MessageAttachmentKind = 'image' | 'media' | 'document';

export interface MessageAttachment {
  jobId: string;
  name: string;
  kind: MessageAttachmentKind;
}

/** Teto por mensagem — mantém o payload e a bolha do histórico sob controle. */
export const MAX_MESSAGE_ATTACHMENTS = 5;

const KINDS: readonly MessageAttachmentKind[] = ['image', 'media', 'document'];

function isMessageAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.jobId === 'string' &&
    candidate.jobId.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.kind === 'string' &&
    KINDS.includes(candidate.kind as MessageAttachmentKind)
  );
}

/**
 * Normaliza o JSONB persistido em uma lista segura de anexos. Como a coluna
 * não tem schema, dados antigos ou malformados não podem chegar ao render —
 * o mesmo cuidado já aplicado às ferramentas em `chat-segments`.
 */
export function parseMessageAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  const normalized: MessageAttachment[] = [];
  for (const item of value) {
    if (!isMessageAttachment(item)) continue;
    normalized.push({ jobId: item.jobId, name: item.name, kind: item.kind });
    if (normalized.length === MAX_MESSAGE_ATTACHMENTS) break;
  }
  return normalized;
}

/**
 * Cruza os ids pedidos pelo cliente com os jobs que o servidor conseguiu
 * resolver para o usuário da sessão. Ids sem correspondência (job inexistente
 * ou de outro workspace) simplesmente somem — a mensagem é enviada mesmo
 * assim, sem anexo fantasma.
 */
export function buildMessageAttachments(
  requestedJobIds: readonly string[],
  resolved: readonly MessageAttachment[],
): MessageAttachment[] {
  const byId = new Map(resolved.map((item) => [item.jobId, item]));
  const attachments: MessageAttachment[] = [];
  const seen = new Set<string>();
  for (const jobId of requestedJobIds) {
    if (seen.has(jobId)) continue;
    const match = byId.get(jobId);
    if (!match) continue;
    seen.add(jobId);
    attachments.push({ jobId: match.jobId, name: match.name, kind: match.kind });
    if (attachments.length === MAX_MESSAGE_ATTACHMENTS) break;
  }
  return attachments;
}
