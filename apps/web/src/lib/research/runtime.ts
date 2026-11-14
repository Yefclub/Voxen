import { structuredDiagnostic } from '../structured-log';
import type { ResearchScheduleCursor } from './schedule';

export function startResearchRuntime(): void {
  void import('./projection')
    .then(({ drainResearchProjections }) => {
      const drain = () => {
        void drainResearchProjections().catch((error) => {
          structuredDiagnostic(
            'warning',
            'research-projection-failed',
            'RESEARCH_PROJECTION_FAILED',
            error,
          );
        });
      };
      drain();
      setInterval(drain, 10_000).unref();
    })
    .catch((error) => {
      structuredDiagnostic(
        'warning',
        'research-projection-unavailable',
        'RESEARCH_PROJECTION_FAILED',
        error,
      );
    });
  void Promise.all([import('./runner'), import('./schedule')])
    .then(([{ drainResearch }, { scheduleCapturedResearch }]) => {
      let busy = false;
      let cursor: ResearchScheduleCursor | null = null;
      const drain = () => {
        if (busy) return;
        busy = true;
        void scheduleCapturedResearch(cursor)
          .then(async (result) => {
            cursor = result.cursor;
            await drainResearch();
          })
          .catch((error) => {
            structuredDiagnostic(
              'warning',
              'research-drain-failed',
              'RESEARCH_DRAIN_FAILED',
              error,
            );
          })
          .finally(() => {
            busy = false;
          });
      };
      drain();
      setInterval(drain, 15_000).unref();
    })
    .catch((error) => {
      structuredDiagnostic(
        'warning',
        'research-runner-unavailable',
        'RESEARCH_RUNNER_UNAVAILABLE',
        error,
      );
    });
}
