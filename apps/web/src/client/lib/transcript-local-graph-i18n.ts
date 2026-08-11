export const ptBrTranscriptLocalGraphMessages = {
  'library.localGraph.title': 'Grafo deste conteúdo',
  'library.localGraph.description':
    'Explore o conhecimento extraído e como ele se conecta ao restante da sua base.',
  'library.localGraph.contentScope': 'Neste conteúdo',
  'library.localGraph.connectionsScope': 'Conexões com a base',
  'library.localGraph.openGlobal': 'Abrir no grafo completo',
  'library.localGraph.loading': 'Carregando conhecimento…',
  'library.localGraph.empty': 'Nenhum conhecimento materializado para esta transcrição.',
  'library.localGraph.notIndexed': 'O Brain ainda não indexou esta transcrição.',
  'library.localGraph.indexing': 'O grafo está sendo compilado em segundo plano.',
  'library.localGraph.partial':
    'A compilação está parcial; os dados disponíveis continuam visíveis.',
  'library.localGraph.failed':
    'A última compilação falhou; os dados materializados anteriormente continuam visíveis.',
  'library.localGraph.progress': '{completed} de {total} segmentos concluídos',
  'library.localGraph.truncated':
    'Exibindo um recorte limitado para manter a visualização legível.',
  'library.localGraph.nodes': 'Nós de conhecimento',
  'library.localGraph.inspector': 'Detalhes do nó',
  'library.localGraph.evidence': 'Evidências',
  'library.localGraph.relations': 'Relações',
  'library.localGraph.noEvidence': 'Este nó não possui passagem navegável nesta transcrição.',
  'library.localGraph.openEvidence': 'Ir para a passagem',
  'library.localGraph.canvasLabel': 'Mapa local de conhecimento da transcrição',
  'library.localGraph.selectNode': 'Selecione um nó para ver relações e evidências.',
  'library.localGraph.error': 'Não foi possível carregar o grafo desta transcrição.',
} as const;

export const enTranscriptLocalGraphMessages: Record<
  keyof typeof ptBrTranscriptLocalGraphMessages,
  string
> = {
  'library.localGraph.title': 'Knowledge graph for this content',
  'library.localGraph.description':
    'Explore extracted knowledge and how it connects to the rest of your library.',
  'library.localGraph.contentScope': 'In this content',
  'library.localGraph.connectionsScope': 'Library connections',
  'library.localGraph.openGlobal': 'Open in the full graph',
  'library.localGraph.loading': 'Loading knowledge…',
  'library.localGraph.empty': 'No knowledge has been materialized for this transcript.',
  'library.localGraph.notIndexed': 'The Brain has not indexed this transcript yet.',
  'library.localGraph.indexing': 'The graph is being compiled in the background.',
  'library.localGraph.partial': 'Compilation is partial; available knowledge remains visible.',
  'library.localGraph.failed':
    'The latest compilation failed; previously materialized knowledge remains visible.',
  'library.localGraph.progress': '{completed} of {total} segments completed',
  'library.localGraph.truncated': 'Showing a bounded slice to keep the visualization readable.',
  'library.localGraph.nodes': 'Knowledge nodes',
  'library.localGraph.inspector': 'Node details',
  'library.localGraph.evidence': 'Evidence',
  'library.localGraph.relations': 'Relations',
  'library.localGraph.noEvidence': 'This node has no navigable passage in the current transcript.',
  'library.localGraph.openEvidence': 'Go to passage',
  'library.localGraph.canvasLabel': 'Local transcript knowledge map',
  'library.localGraph.selectNode': 'Select a node to inspect relations and evidence.',
  'library.localGraph.error': 'Could not load this transcript graph.',
};
