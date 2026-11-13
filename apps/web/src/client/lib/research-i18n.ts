export const ptBrResearchMessages = {
  'research.settings.title': 'Pesquisa da biblioteca',
  'research.settings.description':
    'Encontre contexto externo com fontes verificáveis. Você decide o que incorporar à base.',
  'research.settings.mode': 'Quando pesquisar',
  'research.settings.off': 'Desativada',
  'research.settings.manual': 'Quando eu solicitar',
  'research.settings.auto': 'Em novas capturas',
  'research.settings.offDescription':
    'Nenhuma pesquisa externa é executada. Os documentos e contextos já aceitos continuam disponíveis.',
  'research.settings.manualDescription':
    'Você inicia a pesquisa dentro de cada conteúdo e revisa o resultado antes de aceitar.',
  'research.settings.autoDescription':
    'Pesquisa capturas coletadas a partir da ativação. A biblioteca antiga fica de fora.',
  'research.settings.key': 'Chave da Brave Search API',
  'research.settings.keyPlaceholder': 'Cole uma chave para configurar a pesquisa',
  'research.settings.keyReplace': 'Deixe vazio para manter a chave atual',
  'research.settings.configured': 'Chave configurada: ••••{last4}',
  'research.settings.shared':
    'Esta chave também é usada pela pesquisa web da conversa. As permissões são independentes.',
  'research.settings.remove': 'Remover a chave compartilhada e desativar a pesquisa',
  'research.settings.removeDescription':
    'A conversa também ficará sem a chave de pesquisa web. Os conteúdos salvos são preservados.',
  'research.settings.privacy':
    'Usa o modelo do papel Padrão e pode gerar custos no seu provedor. Trechos são analisados pelo modelo; as perguntas geradas são enviadas à Brave para buscar fontes públicas.',
  'research.settings.save': 'Salvar pesquisa',
  'research.settings.saving': 'Salvando pesquisa…',
  'research.settings.saved': 'Preferências de pesquisa salvas.',
  'research.configure': 'Configurar pesquisa',
  'research.status': 'Estado da pesquisa',
  'research.error.model': 'Configure um modelo para o papel Padrão antes de ativar a pesquisa.',
  'research.error.key': 'Adicione uma chave da Brave Search API para pesquisar fontes externas.',
  'research.error.disabled': 'Ative a pesquisa nas suas preferências de IA para continuar.',
  'research.error.conflict':
    'Este contexto mudou. Confira a versão atual e repita a ação; seu rascunho foi preservado.',
  'research.error.stale':
    'A fonte ou a pesquisa mudou. Solicite uma nova pesquisa antes de aceitar.',
  'research.error.rate':
    'Há muitas solicitações em sequência. Aguarde um minuto e tente novamente.',
  'research.error.missing':
    'Este conteúdo não está disponível. Volte à biblioteca e abra o conteúdo novamente.',
  'research.error.generic':
    'Não foi possível atualizar a pesquisa. Tente novamente; o documento original continua disponível.',
} as const;

export const enResearchMessages: Record<keyof typeof ptBrResearchMessages, string> = {
  'research.settings.title': 'Library research',
  'research.settings.description':
    'Find external context with verifiable sources. You decide what becomes part of your library.',
  'research.settings.mode': 'When to research',
  'research.settings.off': 'Off',
  'research.settings.manual': 'When I request it',
  'research.settings.auto': 'On new captures',
  'research.settings.offDescription':
    'No external research runs. Saved documents and previously accepted context remain available.',
  'research.settings.manualDescription':
    'Start research from a document and review the result before accepting it.',
  'research.settings.autoDescription':
    'Research captures collected after activation. Existing library content is excluded.',
  'research.settings.key': 'Brave Search API key',
  'research.settings.keyPlaceholder': 'Paste a key to configure research',
  'research.settings.keyReplace': 'Leave blank to keep the current key',
  'research.settings.configured': 'Configured key: ••••{last4}',
  'research.settings.shared': 'Chat web research uses this key too. Permissions are independent.',
  'research.settings.remove': 'Remove the shared key and turn research off',
  'research.settings.removeDescription':
    'Chat will also lose its web search key. Saved content is preserved.',
  'research.settings.privacy':
    'Uses the Standard model role and may incur provider costs. The model analyzes source passages; generated questions are sent to Brave to discover public sources.',
  'research.settings.save': 'Save research',
  'research.settings.saving': 'Saving research…',
  'research.settings.saved': 'Research preferences saved.',
  'research.configure': 'Configure research',
  'research.status': 'Research status',
  'research.error.model': 'Configure a model for the Standard role before enabling research.',
  'research.error.key': 'Add a Brave Search API key to research external sources.',
  'research.error.disabled': 'Enable research in your AI preferences to continue.',
  'research.error.conflict':
    'This context changed. Review the current version and try again; your draft has been preserved.',
  'research.error.stale':
    'The source or research changed. Request fresh research before accepting it.',
  'research.error.rate': 'Too many requests in a row. Wait a minute and try again.',
  'research.error.missing': 'This content is unavailable. Return to the library and open it again.',
  'research.error.generic':
    'Could not update research. Try again; the original document remains available.',
};
