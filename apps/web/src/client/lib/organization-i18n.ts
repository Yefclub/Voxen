export const ptBrOrganizationMessages = {
  'organization.authority.CAPTURED_SOURCE': 'Trecho capturado',
  'organization.authority.USER_CORRECTED': 'Trecho corrigido',
  'organization.authority.PREPARED_DOCUMENT': 'Documento publicado',
  'organization.title': 'Conexões com IA',
  'organization.description':
    'Encontre relações entre conceitos com trechos deste conteúdo. O original e suas escolhas manuais são preservados.',
  'organization.disclosure': 'Usa o modelo do papel Padrão e pode gerar custos no seu provedor.',
  'organization.configure': 'Configurar organização',
  'organization.queue': 'Organizar conteúdo',
  'organization.queueing': 'Solicitando análise…',
  'organization.queued': 'Solicitação de organização registrada.',
  'organization.cancel': 'Interromper análise',
  'organization.cancelled':
    'Análise interrompida. As relações válidas já publicadas foram preservadas.',
  'organization.status': 'Estado da organização',
  'organization.off':
    'A organização com IA está desativada. Sua busca e seu grafo continuam disponíveis.',
  'organization.empty': 'Nenhuma análise solicitada para este conteúdo.',
  'organization.archived': 'Restaure o conteúdo arquivado para solicitar uma nova análise.',
  'organization.history': 'Histórico de organização',
  'organization.hasWarnings': 'Com avisos',
  'organization.runLink': 'Abrir esta execução',
  'organization.newer': 'Mais recentes',
  'organization.older': 'Mais antigas',
  'organization.retry': 'Tentar novamente',
  'organization.progress': '{done} de {total} trechos concluídos',
  'organization.progressOne': '{done} de 1 trecho concluído',
  'organization.pending': 'Na fila',
  'organization.running': 'Analisando conteúdo',
  'organization.retrying': 'Aguardando nova tentativa',
  'organization.completed': 'Análise concluída',
  'organization.failed': 'A análise não foi concluída',
  'organization.stopped': 'Interrompida',
  'organization.skipped': 'Sem trechos elegíveis para esta análise',
  'organization.cost': 'Custo confirmado',
  'organization.costLabel': 'Custo',
  'organization.costSoFar': 'Custo confirmado até agora',
  'organization.unknownCost': 'Custo não confirmado',
  'organization.model': 'Modelo usado',
  'organization.tokens': 'Tokens de entrada / saída',
  'organization.confirmedTokens': 'Tokens confirmados: entrada / saída',
  'organization.warning.unsupported': 'Itens sem evidência verificável foram omitidos.',
  'organization.warning.ambiguous': 'Identidades ambíguas não foram unificadas.',
  'organization.warning.inactive': 'Arquivos e escolhas manuais foram respeitados.',
  'organization.warning.usage':
    'O uso de uma chamada interrompida não foi confirmado. O custo total é desconhecido.',
  'organization.warning.generic':
    'Esta análise tem avisos. O conteúdo original continua disponível.',
  'organization.error.model': 'Configure um modelo no papel Padrão antes de ativar a organização.',
  'organization.error.disabled': 'Ative a organização nas suas preferências de IA para continuar.',
  'organization.error.conflict': 'A execução mudou. Confira o estado atual e repita a ação.',
  'organization.error.provenance':
    'Reprocesse esta captura para registrar a origem dos trechos e tente novamente.',
  'organization.error.mapping':
    'Não foi possível acompanhar as correções desta fonte. Confira o original ou reprocesse a captura.',
  'organization.error.large':
    'Este conteúdo é grande demais para esta análise. Organize um conteúdo menor; o original continua disponível.',
  'organization.error.missing':
    'Este conteúdo não está disponível. Volte à biblioteca e abra o conteúdo novamente.',
  'organization.error.rate':
    'Há muitas solicitações em sequência. Aguarde um minuto e tente novamente.',
  'organization.error.timeout':
    'A análise atingiu o limite de tempo. Confira o histórico antes de solicitar outra.',
  'organization.error.generic':
    'Não foi possível atualizar a organização. Tente novamente; o original continua disponível.',
  'organization.settings.title': 'Organização da biblioteca',
  'organization.settings.description':
    'Conecte conceitos e relações no grafo usando evidências dos seus conteúdos, sem pesquisa externa.',
  'organization.settings.mode': 'Quando organizar',
  'organization.settings.off': 'Desativada',
  'organization.settings.manual': 'Quando eu solicitar',
  'organization.settings.auto': 'Em novas capturas',
  'organization.settings.offDescription':
    'Nenhuma análise adicional de organização é executada. As relações já publicadas e a busca continuam disponíveis.',
  'organization.settings.manualDescription':
    'Você solicita a análise dentro de cada conteúdo. As relações sustentadas por trechos são adicionadas ao grafo.',
  'organization.settings.autoDescription':
    'Organiza capturas coletadas a partir da ativação. Não analisa automaticamente a biblioteca anterior.',
  'organization.settings.privacy':
    'Envia os trechos elegíveis ao seu modelo Padrão e pode gerar custos no provedor. Não altera pastas, tags ou o documento original.',
  'organization.settings.save': 'Salvar organização',
  'organization.settings.saving': 'Salvando organização…',
  'organization.settings.saved': 'Preferências de organização salvas.',
  'organization.settings.status': 'Estado das preferências de organização',
} as const;

export const enOrganizationMessages: Record<keyof typeof ptBrOrganizationMessages, string> = {
  'organization.authority.CAPTURED_SOURCE': 'Captured passage',
  'organization.authority.USER_CORRECTED': 'Corrected passage',
  'organization.authority.PREPARED_DOCUMENT': 'Published document',
  'organization.title': 'AI connections',
  'organization.description':
    'Connect concepts using passages from this document. The original and your manual choices are preserved.',
  'organization.disclosure': 'Uses the Standard model role and may incur provider costs.',
  'organization.configure': 'Configure organization',
  'organization.queue': 'Organize content',
  'organization.queueing': 'Requesting analysis…',
  'organization.queued': 'Organization request recorded.',
  'organization.cancel': 'Stop analysis',
  'organization.cancelled':
    'Analysis stopped. Valid relationships already published were preserved.',
  'organization.status': 'Organization status',
  'organization.off': 'AI organization is off. Search and your graph remain available.',
  'organization.empty': 'No analysis requested for this document.',
  'organization.archived': 'Restore the archived document to request a new analysis.',
  'organization.history': 'Organization history',
  'organization.hasWarnings': 'With warnings',
  'organization.runLink': 'Open this run',
  'organization.newer': 'Newer',
  'organization.older': 'Older',
  'organization.retry': 'Try again',
  'organization.progress': '{done} of {total} passages completed',
  'organization.progressOne': '{done} of 1 passage completed',
  'organization.pending': 'Queued',
  'organization.running': 'Analyzing content',
  'organization.retrying': 'Waiting to retry',
  'organization.completed': 'Analysis complete',
  'organization.failed': 'Analysis did not complete',
  'organization.stopped': 'Stopped',
  'organization.skipped': 'No eligible passages for this analysis',
  'organization.cost': 'Confirmed cost',
  'organization.costLabel': 'Cost',
  'organization.costSoFar': 'Confirmed cost so far',
  'organization.unknownCost': 'Unconfirmed cost',
  'organization.model': 'Model used',
  'organization.tokens': 'Input / output tokens',
  'organization.confirmedTokens': 'Confirmed tokens: input / output',
  'organization.warning.unsupported': 'Items without verifiable evidence were omitted.',
  'organization.warning.ambiguous': 'Ambiguous identities were not merged.',
  'organization.warning.inactive': 'Archives and manual choices were respected.',
  'organization.warning.usage':
    'Usage for an interrupted call was not confirmed. The total cost is unknown.',
  'organization.warning.generic':
    'This analysis has warnings. The original document remains available.',
  'organization.error.model':
    'Configure a model for the Standard role before enabling organization.',
  'organization.error.disabled': 'Enable organization in your AI preferences to continue.',
  'organization.error.conflict': 'This run changed. Review its current state and try again.',
  'organization.error.provenance':
    'Reprocess this capture to record passage provenance, then try again.',
  'organization.error.mapping':
    'Could not trace the corrections to this source. Review the original or reprocess the capture.',
  'organization.error.large':
    'This document is too large for this analysis. Organize a smaller document; the original remains available.',
  'organization.error.missing':
    'This content is unavailable. Return to the library and open it again.',
  'organization.error.rate': 'Too many requests in a row. Wait a minute and try again.',
  'organization.error.timeout':
    'The analysis reached its time limit. Review the history before requesting another.',
  'organization.error.generic':
    'Could not update organization. Try again; the original remains available.',
  'organization.settings.title': 'Library organization',
  'organization.settings.description':
    'Connect graph concepts and relationships using evidence from your documents, without external research.',
  'organization.settings.mode': 'When to organize',
  'organization.settings.off': 'Off',
  'organization.settings.manual': 'When I request it',
  'organization.settings.auto': 'On new captures',
  'organization.settings.offDescription':
    'No additional organization analysis runs. Published relationships and search remain available.',
  'organization.settings.manualDescription':
    'Request analysis from a document. Relationships supported by passages are added to the graph.',
  'organization.settings.autoDescription':
    'Organizes captures collected after activation. Existing library content is not analyzed automatically.',
  'organization.settings.privacy':
    'Sends eligible passages to your Standard model and may incur provider costs. Folders, tags and the original document are preserved.',
  'organization.settings.save': 'Save organization',
  'organization.settings.saving': 'Saving organization…',
  'organization.settings.saved': 'Organization preferences saved.',
  'organization.settings.status': 'Organization preferences status',
};
