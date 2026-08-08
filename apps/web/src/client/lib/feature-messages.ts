import {
  enKnowledgeFeatureMessages,
  ptBrKnowledgeFeatureMessages,
} from './knowledge-features-i18n';
import { enSavedMediaMessages, ptBrSavedMediaMessages } from './saved-media-i18n';

export const ptBrFeatureMessages = {
  ...ptBrKnowledgeFeatureMessages,
  ...ptBrSavedMediaMessages,
} as const;

export const enFeatureMessages: Record<keyof typeof ptBrFeatureMessages, string> = {
  ...enKnowledgeFeatureMessages,
  ...enSavedMediaMessages,
};
