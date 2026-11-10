// Job stage labels. Research stages only render jobs already in history (no
// new research jobs since spec 215); capture stages are live (spec 220).

import type { I18nKey } from './i18n';

export const ptBrJobStageMessages = {
  'job.stage.researchPlanning': 'Avaliando lacunas do conteúdo',
  'job.stage.researchSourceLookup': 'Consultando a fonte original',
  'job.stage.researchSearching': 'Pesquisando contexto adicional',
  'job.stage.researchSynthesizing': 'Organizando evidências encontradas',
  'job.stage.researchNotNeeded': 'Pesquisa adicional não necessária',
  'job.stage.researchReady': 'Contexto adicional pronto para revisão',
  'job.stage.researchRetry': 'Pesquisa aguardando nova tentativa',
  'job.stage.researchFailed': 'Pesquisa adicional falhou',
  'job.stage.researchCancelled': 'Pesquisa adicional cancelada',
  'job.stage.extracting': 'Extraindo conteúdo',
  'job.stage.describingImages': 'Descrevendo imagens',
  'job.stage.interpreting': 'Interpretando com IA',
  'job.stage.publishing': 'Publicando documento',
} as const;

export const enJobStageMessages: Record<keyof typeof ptBrJobStageMessages, string> = {
  'job.stage.researchPlanning': 'Evaluating content gaps',
  'job.stage.researchSourceLookup': 'Consulting the original source',
  'job.stage.researchSearching': 'Researching additional context',
  'job.stage.researchSynthesizing': 'Organizing found evidence',
  'job.stage.researchNotNeeded': 'Additional research not needed',
  'job.stage.researchReady': 'Additional context ready for review',
  'job.stage.researchRetry': 'Research waiting for another attempt',
  'job.stage.researchFailed': 'Additional research failed',
  'job.stage.researchCancelled': 'Additional research cancelled',
  'job.stage.extracting': 'Extracting content',
  'job.stage.describingImages': 'Describing images',
  'job.stage.interpreting': 'Interpreting with AI',
  'job.stage.publishing': 'Publishing document',
};

/**
 * Label key for a capture job stage. `transcribing` and the shared queue and
 * terminal stages reuse the generic `job.stage.*` keys from i18n.tsx; unknown
 * stages fall back to "starting".
 */
export function captureStageKey(stage: string | null | undefined): I18nKey {
  switch (stage) {
    case 'queued':
      return 'job.stage.queued';
    case 'extracting':
      return 'job.stage.extracting';
    case 'transcribing':
      return 'job.stage.transcribing';
    case 'describing_images':
      return 'job.stage.describingImages';
    case 'interpreting':
      return 'job.stage.interpreting';
    case 'publishing':
      return 'job.stage.publishing';
    case 'done':
      return 'job.stage.done';
    case 'completed_with_warnings':
      return 'job.stage.completedWithWarnings';
    case 'failed':
      return 'job.stage.failed';
    case 'cancelled':
      return 'job.stage.cancelled';
    default:
      return 'job.stage.running';
  }
}
