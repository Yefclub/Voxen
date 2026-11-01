// Job stage labels for research jobs already in history. No new research
// jobs are created (spec 215); these strings only render past stages.

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
};
