import type { JobStatus } from './types';
import type { TranslateFn } from './i18n';

type BadgeVariant = 'default' | 'outline' | 'success' | 'warning' | 'danger' | 'muted';

export function jobStatusBadge(
  status: JobStatus,
  t?: TranslateFn,
): { variant: BadgeVariant; label: string } {
  switch (status) {
    case 'QUEUED':
      return { variant: 'muted', label: t?.('job.status.queued') ?? 'Na fila' };
    case 'RUNNING':
      return { variant: 'warning', label: t?.('job.status.running') ?? 'Processando' };
    case 'DONE':
      return { variant: 'success', label: t?.('job.status.done') ?? 'Concluído' };
    case 'FAILED':
      return { variant: 'danger', label: t?.('job.status.failed') ?? 'Falhou' };
    case 'CANCELLED':
      return { variant: 'outline', label: t?.('job.status.cancelled') ?? 'Cancelado' };
  }
}

export function stageLabel(stage: string, t?: TranslateFn): string {
  const map: Record<string, string> = {
    queued: t?.('job.stage.queued') ?? 'Na fila',
    running: t?.('job.stage.running') ?? 'Iniciando',
    downloading: t?.('job.stage.downloading') ?? 'Baixando vídeo',
    preparing_upload: t?.('job.stage.preparingUpload') ?? 'Preparando arquivo',
    analyzing_image: t?.('job.stage.analyzingImage') ?? 'Analisando imagem',
    analyzing_x: t?.('job.stage.analyzingX') ?? 'Analisando X',
    converting_document: t?.('job.stage.convertingDocument') ?? 'Convertendo documento',
    analyzing_document: t?.('job.stage.analyzingDocument') ?? 'Analisando documento',
    extracting_audio: t?.('job.stage.extractingAudio') ?? 'Extraindo áudio',
    choosing_method: t?.('job.stage.choosingMethod') ?? 'Escolhendo método',
    transcribing: t?.('job.stage.transcribing') ?? 'Transcrevendo',
    uploading: t?.('job.stage.uploading') ?? 'Enviando para armazenamento',
    indexing: t?.('job.stage.indexing') ?? 'Indexando',
    summarizing: t?.('job.stage.summarizing') ?? 'Gerando resumo',
    done: t?.('job.stage.done') ?? 'Concluído',
    failed: t?.('job.stage.failed') ?? 'Falhou',
    cancelled: t?.('job.stage.cancelled') ?? 'Cancelado',
  };
  return map[stage] ?? stage;
}
