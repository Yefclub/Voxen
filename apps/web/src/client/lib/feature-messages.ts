import {
  enKnowledgeFeatureMessages,
  ptBrKnowledgeFeatureMessages,
} from './knowledge-features-i18n';
import { enSavedMediaMessages, ptBrSavedMediaMessages } from './saved-media-i18n';
import { enBatchIngestMessages, ptBrBatchIngestMessages } from './batch-ingest-i18n';

export const ptBrFeatureMessages = {
  ...ptBrKnowledgeFeatureMessages,
  ...ptBrSavedMediaMessages,
  ...ptBrBatchIngestMessages,
} as const;

export const enFeatureMessages: Record<keyof typeof ptBrFeatureMessages, string> = {
  ...enKnowledgeFeatureMessages,
  ...enSavedMediaMessages,
  ...enBatchIngestMessages,
};
