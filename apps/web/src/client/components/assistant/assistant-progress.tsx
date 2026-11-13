import { ChevronRight, LoaderCircle } from '../ui/icons';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';

export function AssistantProgress({
  activity,
  connected,
  writing,
  model,
}: {
  activity: string | null;
  connected: boolean;
  writing: boolean;
  model: string | null;
}) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const label = !connected ? copy.reconnecting : writing ? copy.writing : copy.working;
  const toolLabel = activity
    ? (copy.tools[activity as keyof typeof copy.tools] ?? copy.searching)
    : null;
  return (
    <details className="assistant-progress" data-chat-progress>
      <summary>
        <LoaderCircle className="assistant-progress-spinner h-4 w-4 shrink-0" />
        <span role="status" className="min-w-0 flex-1">
          {label}
        </span>
        <ChevronRight className="assistant-progress-chevron h-4 w-4 shrink-0" />
      </summary>
      <div className="pb-3 pl-7 text-sm">
        {toolLabel && (
          <p className="py-2 text-[var(--color-app-subtle)]">
            {copy.lastActivity}: {toolLabel}
          </p>
        )}
        <p className="py-2 leading-relaxed text-[var(--color-app-muted)]">
          {connected ? copy.progressHint : copy.reconnectHint}
        </p>
        {model && <p className="break-words text-xs text-[var(--color-app-muted)]">{model}</p>}
      </div>
    </details>
  );
}
