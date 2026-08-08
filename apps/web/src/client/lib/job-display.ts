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
    case 'COMPLETED_WITH_WARNINGS':
      return {
        variant: 'warning',
        label: t?.('job.status.completedWithWarnings') ?? 'Concluído com pendências',
      };
    case 'FAILED':
      return { variant: 'danger', label: t?.('job.status.failed') ?? 'Falhou' };
    case 'CANCELLED':
      return { variant: 'outline', label: t?.('job.status.cancelled') ?? 'Cancelado' };
  }
}

export function stageLabel(stage: string, t?: TranslateFn, jobType?: JobType): string {
  const contextual = contextualStageLabel(stage, jobType, t);
  if (contextual) return contextual;
  const map: Record<string, string> = {
    queued: t?.('job.stage.queued') ?? 'Na fila',
    running: t?.('job.stage.running') ?? 'Iniciando',
    downloading: t?.('job.stage.downloading') ?? 'Baixando vídeo',
    probing_media: t?.('job.stage.probingMedia') ?? 'Lendo dados da mídia',
    downloading_media: t?.('job.stage.downloadingMedia') ?? 'Baixando mídia',
    storing_media: t?.('job.stage.storingMedia') ?? 'Salvando mídia',
    media_ready: t?.('job.stage.mediaReady') ?? 'Mídia pronta',
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
    indexing_brain: t?.('job.stage.indexingBrain') ?? 'Conectando ao Brain',
    completed_with_warnings: t?.('job.stage.completedWithWarnings') ?? 'Concluído com pendências',
    done: t?.('job.stage.done') ?? 'Concluído',
    failed: t?.('job.stage.failed') ?? 'Falhou',
    cancelled: t?.('job.stage.cancelled') ?? 'Cancelado',
  };
  return map[stage] ?? humanizeStage(stage);
}

function contextualStageLabel(
  stage: string,
  jobType: JobType | undefined,
  t?: TranslateFn,
): string | null {
  if (!jobType) return null;
  if (stage === 'indexing') {
    return t?.('job.stage.indexingBrain') ?? 'Conectando ao Brain';
  }
  if (stage === 'uploading') {
    return t?.('job.stage.savingContent') ?? 'Salvando conteúdo';
  }
  if (jobType === 'SCRAPE_WEB' && stage === 'downloading') {
    return t?.('job.stage.readingWeb') ?? 'Lendo página';
  }
  if (jobType === 'DOWNLOAD_AND_TRANSCRIBE') {
    if (stage === 'downloading') {
      return t?.('job.stage.capturingMedia') ?? 'Capturando mídia';
    }
    if (stage === 'choosing_method') {
      return t?.('job.stage.preparingTranscript') ?? 'Preparando transcrição';
    }
  }
  if (jobType === 'UPLOAD_AND_ANALYZE_DOCUMENT') {
    if (stage === 'preparing_upload') {
      return t?.('job.stage.preparingDocument') ?? 'Preparando documento';
    }
    if (stage === 'converting_document') {
      return t?.('job.stage.documentToMarkdown') ?? 'Convertendo para Markdown';
    }
    if (stage === 'analyzing_document') {
      return t?.('job.stage.readingDocument') ?? 'Lendo conteúdo do documento';
    }
  }
  if (jobType === 'UPLOAD_AND_ANALYZE_IMAGE' && stage === 'preparing_upload') {
    return t?.('job.stage.preparingImage') ?? 'Preparando imagem';
  }
  if (jobType === 'ANALYZE_X' && stage === 'converting_document') {
    return t?.('job.stage.readingX') ?? 'Lendo publicação do X';
  }
  return null;
}

function humanizeStage(stage: string): string {
  const normalized = stage.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) return 'Processando conteúdo';
  return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
}

export function jobTypeLabel(type: JobType | undefined, t?: TranslateFn): string {
  const map: Record<JobType, string> = {
    DOWNLOAD_MEDIA: t?.('job.type.download') ?? 'Download de mídia',
    DOWNLOAD_AND_TRANSCRIBE: t?.('job.type.video') ?? 'Vídeo',
    SCRAPE_WEB: t?.('job.type.web') ?? 'Página web',
    UPLOAD_AND_TRANSCRIBE: t?.('job.type.upload') ?? 'Arquivo de mídia',
    UPLOAD_AND_ANALYZE_IMAGE: t?.('job.type.image') ?? 'Imagem',
    UPLOAD_AND_ANALYZE_DOCUMENT: t?.('job.type.document') ?? 'Documento',
    ANALYZE_X: t?.('job.type.x') ?? 'Publicação no X',
  };
  return type ? map[type] : (t?.('job.type.content') ?? 'Conteúdo');
}
