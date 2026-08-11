import {
  enKnowledgeFeatureMessages,
  ptBrKnowledgeFeatureMessages,
} from './knowledge-features-i18n';
import { enSavedMediaMessages, ptBrSavedMediaMessages } from './saved-media-i18n';
import { enBatchIngestMessages, ptBrBatchIngestMessages } from './batch-ingest-i18n';
import {
  enLibraryNavigationMessages,
  ptBrLibraryNavigationMessages,
} from './library-navigation-i18n';
import {
  enTranscriptLocalGraphMessages,
  ptBrTranscriptLocalGraphMessages,
} from './transcript-local-graph-i18n';

export const ptBrFeatureMessages = {
  ...ptBrKnowledgeFeatureMessages,
  ...ptBrSavedMediaMessages,
  ...ptBrBatchIngestMessages,
  ...ptBrLibraryNavigationMessages,
  ...ptBrTranscriptLocalGraphMessages,
} as const;

export const enFeatureMessages: Record<keyof typeof ptBrFeatureMessages, string> = {
  ...enKnowledgeFeatureMessages,
  ...enSavedMediaMessages,
  ...enBatchIngestMessages,
  ...enLibraryNavigationMessages,
  ...enTranscriptLocalGraphMessages,
};
