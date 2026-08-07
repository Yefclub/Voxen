export const ptBrTranscriptAnnotationMessages = {
  'library.annotationAnchor': 'Passagem ancorada',
  'library.annotationQuote': 'Citação selecionada',
  'library.annotationStartLine': 'Linha inicial',
  'library.annotationEndLine': 'Linha final',
  'library.annotationStartSec': 'Segundo inicial',
  'library.annotationEndSec': 'Segundo final',
  'library.annotationManual': 'Adicionar passagem manualmente',
  'library.annotationValid': 'Âncora válida',
  'library.annotationStale': 'Fonte alterada',
  'library.annotationOpen': 'Abrir passagem',
  'transcript.annotateSelection': 'Anotar seleção',
} as const;

export const enTranscriptAnnotationMessages: Record<
  keyof typeof ptBrTranscriptAnnotationMessages,
  string
> = {
  'library.annotationAnchor': 'Anchored passage',
  'library.annotationQuote': 'Selected quote',
  'library.annotationStartLine': 'Start line',
  'library.annotationEndLine': 'End line',
  'library.annotationStartSec': 'Start second',
  'library.annotationEndSec': 'End second',
  'library.annotationManual': 'Add a passage manually',
  'library.annotationValid': 'Valid anchor',
  'library.annotationStale': 'Source changed',
  'library.annotationOpen': 'Open passage',
  'transcript.annotateSelection': 'Annotate selection',
};
