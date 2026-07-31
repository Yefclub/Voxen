/**
 * Rótulos de etapa do job — espelha apps/web/src/client/lib/job-display.ts
 * (mesmas strings PT-BR usadas na fila do app, sem i18n pois a extensão só
 * existe em PT-BR). Usado para mostrar a etapa real do processamento
 * (baixando / transcrevendo / resumindo…) quando `progressStage` vem
 * preenchido no status do job.
 */

const BASE_LABELS = {
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
  tagging: 'Gerando tags',
  done: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

/**
 * @param {string} stage
 * @param {string} [jobType]
 */
function contextualLabel(stage, jobType) {
  if (!jobType) return null;
  if (stage === 'indexing') return 'Conectando ao Brain';
  if (stage === 'uploading') return 'Salvando conteúdo';
  if (jobType === 'SCRAPE_WEB' && stage === 'downloading') return 'Lendo página';
  if (jobType === 'DOWNLOAD_AND_TRANSCRIBE') {
    if (stage === 'downloading') return 'Capturando mídia';
    if (stage === 'choosing_method') return 'Preparando transcrição';
  }
  if (jobType === 'UPLOAD_AND_ANALYZE_DOCUMENT') {
    if (stage === 'preparing_upload') return 'Preparando documento';
    if (stage === 'converting_document') return 'Convertendo para Markdown';
    if (stage === 'analyzing_document') return 'Lendo conteúdo do documento';
  }
  if (jobType === 'UPLOAD_AND_ANALYZE_IMAGE' && stage === 'preparing_upload') {
    return 'Preparando imagem';
  }
  if (jobType === 'ANALYZE_X' && stage === 'converting_document') {
    return 'Lendo publicação do X';
  }
  return null;
}

/**
 * @param {string} stage
 */
function humanizeStage(stage) {
  const normalized = String(stage || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!normalized) return 'Processando conteúdo';
  return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
}

/**
 * @param {string} stage
 * @param {string} [jobType]
 * @returns {string}
 */
export function stageLabel(stage, jobType) {
  if (!stage) return 'Processando…';
  const contextual = contextualLabel(stage, jobType);
  if (contextual) return contextual;
  return BASE_LABELS[stage] ?? humanizeStage(stage);
}
