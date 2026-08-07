export const ptBrKnowledgeFeatureMessages = {
  'library.additionalContext': 'Contexto adicional',
  'library.additionalContextDescription':
    'Pesquisa externa citada, separada do resumo e revisada por você.',
  'library.additionalContextResearch': 'Pesquisar contexto',
  'library.additionalContextRunning': 'Pesquisando',
  'library.additionalContextRunningDescription':
    'A pesquisa ocorre em segundo plano e não bloqueia o conteúdo.',
  'library.additionalContextDisabled':
    'A pesquisa adicional está desativada na configuração da instância.',
  'library.additionalContextEmpty': 'Nenhum contexto externo foi pesquisado ainda.',
  'library.additionalContextQueued': 'Pesquisa de contexto adicionada à fila.',
  'library.additionalContextError': 'Não foi possível atualizar o contexto adicional.',
  'library.additionalContextStale': 'Desatualizado',
  'library.additionalContextStatus.pending': 'Pendente',
  'library.additionalContextStatus.running': 'Em pesquisa',
  'library.additionalContextStatus.no_research_needed': 'Pesquisa dispensada',
  'library.additionalContextStatus.ready': 'Aguardando revisão',
  'library.additionalContextStatus.retry': 'Nova tentativa agendada',
  'library.additionalContextStatus.failed': 'Falhou',
  'library.additionalContextStatus.cancelled': 'Cancelado',
  'library.additionalContextNoResearch': 'A fonte já contém contexto suficiente.',
  'library.additionalContextFailed':
    'A pesquisa falhou sem afetar a transcrição ou o resumo. Você pode solicitar outra execução.',
  'library.additionalContextWhy': 'Por que foi pesquisado:',
  'library.additionalContextSources': 'Fontes externas',
  'library.additionalContextAccept': 'Aceitar contexto',
  'library.additionalContextDismiss': 'Dispensar',
  'library.additionalContextDeleteTitle': 'Excluir este contexto adicional?',
  'library.additionalContextDeleteDescription':
    'A pesquisa e seus derivados no grafo serão removidos. A transcrição e o resumo não mudam.',
  'admin.integrations.researchPolicy.title': 'Pesquisa após o resumo',
  'admin.integrations.researchPolicy.description':
    'Controle quando a IA pode pesquisar contexto externo para uma transcrição já resumida.',
  'admin.integrations.researchPolicy.off.title': 'Desativada',
  'admin.integrations.researchPolicy.off.description':
    'Não cria nem executa novas pesquisas de contexto.',
  'admin.integrations.researchPolicy.manual.title': 'Somente manual',
  'admin.integrations.researchPolicy.manual.description':
    'Usuários e clientes MCP podem solicitar a pesquisa explicitamente.',
  'admin.integrations.researchPolicy.auto.title': 'Automática e manual',
  'admin.integrations.researchPolicy.auto.description':
    'Após o resumo, a IA decide se existe uma lacuna material a pesquisar.',
  'admin.integrations.researchPolicy.boundary':
    'A pesquisa nunca altera o resumo. Todo contexto externo entra como sugestão citada e exige revisão.',
  'admin.integrations.researchPolicy.saved': 'Política de pesquisa atualizada.',
} as const;

export const enKnowledgeFeatureMessages: Record<keyof typeof ptBrKnowledgeFeatureMessages, string> =
  {
    'library.additionalContext': 'Additional context',
    'library.additionalContextDescription':
      'Cited external research, kept separate from the summary and reviewed by you.',
    'library.additionalContextResearch': 'Research context',
    'library.additionalContextRunning': 'Researching',
    'library.additionalContextRunningDescription':
      'Research runs in the background and does not block the content.',
    'library.additionalContextDisabled':
      'Additional research is disabled in the instance configuration.',
    'library.additionalContextEmpty': 'No external context has been researched yet.',
    'library.additionalContextQueued': 'Context research was queued.',
    'library.additionalContextError': 'Could not update the additional context.',
    'library.additionalContextStale': 'Stale',
    'library.additionalContextStatus.pending': 'Pending',
    'library.additionalContextStatus.running': 'Researching',
    'library.additionalContextStatus.no_research_needed': 'Research not needed',
    'library.additionalContextStatus.ready': 'Awaiting review',
    'library.additionalContextStatus.retry': 'Retry scheduled',
    'library.additionalContextStatus.failed': 'Failed',
    'library.additionalContextStatus.cancelled': 'Cancelled',
    'library.additionalContextNoResearch': 'The source already contains enough context.',
    'library.additionalContextFailed':
      'Research failed without affecting the transcript or summary. You can request another run.',
    'library.additionalContextWhy': 'Why it was researched:',
    'library.additionalContextSources': 'External sources',
    'library.additionalContextAccept': 'Accept context',
    'library.additionalContextDismiss': 'Dismiss',
    'library.additionalContextDeleteTitle': 'Delete this additional context?',
    'library.additionalContextDeleteDescription':
      'The research and its graph derivatives will be removed. The transcript and summary remain unchanged.',
    'admin.integrations.researchPolicy.title': 'Post-summary research',
    'admin.integrations.researchPolicy.description':
      'Control when AI may research external context for an already summarized transcript.',
    'admin.integrations.researchPolicy.off.title': 'Disabled',
    'admin.integrations.researchPolicy.off.description':
      'Does not create or execute new context research.',
    'admin.integrations.researchPolicy.manual.title': 'Manual only',
    'admin.integrations.researchPolicy.manual.description':
      'Users and MCP clients may explicitly request research.',
    'admin.integrations.researchPolicy.auto.title': 'Automatic and manual',
    'admin.integrations.researchPolicy.auto.description':
      'After the summary, AI decides whether there is a material gap to research.',
    'admin.integrations.researchPolicy.boundary':
      'Research never changes the summary. All external context is a cited suggestion that requires review.',
    'admin.integrations.researchPolicy.saved': 'Research policy updated.',
  };
