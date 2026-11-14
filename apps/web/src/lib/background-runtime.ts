import { startResearchRuntime } from './research/runtime';
import { startOrganizationRuntime } from './organization/runtime';
import { startPassageIndexRuntime } from './passage-index/runtime';

export function startKnowledgeRuntimes(): void {
  startResearchRuntime();
  startOrganizationRuntime();
  startPassageIndexRuntime();
}
