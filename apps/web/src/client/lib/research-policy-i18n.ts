export const ptBrResearchPolicyMessages = {
  'admin.integrations.researchPolicy.title': 'Pesquisa posterior ao resumo',
  'admin.integrations.researchPolicy.description':
    'Controla se a Voxen pode pesquisar contexto externo depois de salvar um resumo baseado somente na fonte.',
  'admin.integrations.researchPolicy.off.title': 'Desativada',
  'admin.integrations.researchPolicy.off.description': 'Nenhuma pesquisa externa é executada.',
  'admin.integrations.researchPolicy.manual.title': 'Somente manual',
  'admin.integrations.researchPolicy.manual.description':
    'Usuários e clientes MCP podem solicitar uma pesquisa por conteúdo.',
  'admin.integrations.researchPolicy.auto.title': 'Automática seletiva',
  'admin.integrations.researchPolicy.auto.description':
    'A IA decide se lacunas materiais justificam zero ou mais buscas limitadas.',
  'admin.integrations.researchPolicy.boundary':
    'O resultado sempre nasce como sugestão citada para revisão e nunca altera o resumo canônico.',
  'admin.integrations.researchPolicy.saved': 'Política de pesquisa atualizada.',
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

export const enResearchPolicyMessages: Record<keyof typeof ptBrResearchPolicyMessages, string> = {
  'admin.integrations.researchPolicy.title': 'Post-summary research',
  'admin.integrations.researchPolicy.description':
    'Controls whether Voxen may research external context after saving a source-only summary.',
  'admin.integrations.researchPolicy.off.title': 'Off',
  'admin.integrations.researchPolicy.off.description': 'No external research is performed.',
  'admin.integrations.researchPolicy.manual.title': 'Manual only',
  'admin.integrations.researchPolicy.manual.description':
    'Users and MCP clients may request research for an individual item.',
  'admin.integrations.researchPolicy.auto.title': 'Selective automatic',
  'admin.integrations.researchPolicy.auto.description':
    'The model decides whether material gaps justify zero or more bounded searches.',
  'admin.integrations.researchPolicy.boundary':
    'Every result starts as a cited suggestion for review and never changes the canonical summary.',
  'admin.integrations.researchPolicy.saved': 'Research policy updated.',
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
