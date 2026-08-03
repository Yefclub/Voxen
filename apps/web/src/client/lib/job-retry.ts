// Reprocessamento de item da fila — contrato do `POST /api/jobs/:id/retry`.
//
// O endpoint já existe, deriva o `userId` da sessão (nunca do body), recusa job
// que não seja do dono (404), recusa status não-terminal (400) e trata a corrida
// de deduplicação (P2002 → devolve o job ativo). Aqui fica só o que a UI precisa
// decidir: quando oferecer a ação e como traduzir o resultado em feedback.

import type { JobStatus } from './types';

/** Só job terminado em erro/cancelamento pode ser reenfileirado. */
export function canRetryJob(status: JobStatus): boolean {
  return status === 'FAILED' || status === 'CANCELLED' || status === 'COMPLETED_WITH_WARNINGS';
}

export type JobRetryFeedback =
  | { kind: 'queued'; jobId: string }
  | { kind: 'refused'; message: string };

export type JobRetryOutcome =
  | { ok: true; jobId?: string | null }
  | { ok: false; message?: string | null };

/** Motivo legível da recusa — cai no texto padrão quando o servidor não manda um. */
export function jobRetryRefusalMessage(
  message: string | null | undefined,
  fallbackMessage: string,
): string {
  return message?.trim() || fallbackMessage;
}

/**
 * Traduz o resultado da chamada em feedback. Recusa mantém o item no estado
 * anterior — a UI não muta nada, só mostra o motivo.
 */
export function resolveJobRetryFeedback(
  outcome: JobRetryOutcome,
  fallbackMessage: string,
): JobRetryFeedback {
  if (outcome.ok) {
    const jobId = outcome.jobId?.trim();
    return jobId ? { kind: 'queued', jobId } : { kind: 'refused', message: fallbackMessage };
  }
  return { kind: 'refused', message: jobRetryRefusalMessage(outcome.message, fallbackMessage) };
}
