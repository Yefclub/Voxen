import type { JobStatus, JobType } from './types';
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

export function stageLabel(stage: string, t?: TranslateFn, jobType?: JobType): string {
  if (stage === 'downloading' && jobType === 'SCRAPE_WEB') {
    return t?.('job.stage.readingWeb') ?? 'Lendo página';
  }
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
    tagging: t?.('job.stage.tagging') ?? 'Gerando tags',
    done: t?.('job.stage.done') ?? 'Concluído',
    failed: t?.('job.stage.failed') ?? 'Falhou',
    cancelled: t?.('job.stage.cancelled') ?? 'Cancelado',
  };
  return map[stage] ?? stage;
}

export function jobTypeLabel(type: JobType | undefined, t?: TranslateFn): string {
  const map: Record<JobType, string> = {
    DOWNLOAD_AND_TRANSCRIBE: t?.('job.type.video') ?? 'Vídeo',
    SCRAPE_WEB: t?.('job.type.web') ?? 'Página web',
    UPLOAD_AND_TRANSCRIBE: t?.('job.type.upload') ?? 'Arquivo de mídia',
    UPLOAD_AND_ANALYZE_IMAGE: t?.('job.type.image') ?? 'Imagem',
    UPLOAD_AND_ANALYZE_DOCUMENT: t?.('job.type.document') ?? 'Documento',
    ANALYZE_X: t?.('job.type.x') ?? 'Publicação no X',
  };
  return type ? map[type] : (t?.('job.type.content') ?? 'Conteúdo');
}
