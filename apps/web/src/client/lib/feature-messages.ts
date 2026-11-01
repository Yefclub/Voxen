import {
  enKnowledgeFeatureMessages,
  ptBrKnowledgeFeatureMessages,
} from './knowledge-features-i18n';
import {
  enLibraryNavigationMessages,
  ptBrLibraryNavigationMessages,
} from './library-navigation-i18n';
import {
  enTranscriptLocalGraphMessages,
  ptBrTranscriptLocalGraphMessages,
} from './transcript-local-graph-i18n';
import {
  enPersonalInterestMessages,
  ptBrPersonalInterestMessages,
} from './personal-interest-signals-i18n';
import { enPersonalGuideMessages, ptBrPersonalGuideMessages } from './personal-guide-i18n';

export const ptBrFeatureMessages = {
  ...ptBrKnowledgeFeatureMessages,
  ...ptBrLibraryNavigationMessages,
  ...ptBrTranscriptLocalGraphMessages,
  ...ptBrPersonalInterestMessages,
  ...ptBrPersonalGuideMessages,
} as const;

export const enFeatureMessages: Record<keyof typeof ptBrFeatureMessages, string> = {
  ...enKnowledgeFeatureMessages,
  ...enLibraryNavigationMessages,
  ...enTranscriptLocalGraphMessages,
  ...enPersonalInterestMessages,
  ...enPersonalGuideMessages,
};
