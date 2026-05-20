import type { JobStatus } from './types';

type BadgeVariant = 'default' | 'outline' | 'success' | 'warning' | 'danger' | 'muted';

export function jobStatusBadge(status: JobStatus): { variant: BadgeVariant; label: string } {
  switch (status) {
    case 'QUEUED':
      return { variant: 'muted', label: 'Na fila' };
    case 'RUNNING':
      return { variant: 'warning', label: 'Processando' };
    case 'DONE':
      return { variant: 'success', label: 'Concluído' };
    case 'FAILED':
      return { variant: 'danger', label: 'Falhou' };
    case 'CANCELLED':
      return { variant: 'outline', label: 'Cancelado' };
  }
}

export function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    queued: 'Na fila',
    running: 'Iniciando',
    downloading: 'Baixando vídeo',
    preparing_upload: 'Preparando arquivo',
    analyzing_image: 'Analisando imagem',
    analyzing_x: 'Analisando X',
    converting_document: 'Convertendo documento',
    analyzing_document: 'Analisando documento',
    extracting_audio: 'Extraindo áudio',
    choosing_method: 'Escolhendo método',
    transcribing: 'Transcrevendo',
    uploading: 'Enviando para armazenamento',
    indexing: 'Indexando',
    summarizing: 'Gerando resumo',
    done: 'Concluído',
    failed: 'Falhou',
    cancelled: 'Cancelado',
  };
  return map[stage] ?? stage;
}
