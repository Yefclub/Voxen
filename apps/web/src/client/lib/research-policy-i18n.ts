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
};
