import { useId, useState } from 'react';
import { Button } from '../ui/button';
import { Library, AlertCircle, Pencil, RotateCcw } from '../ui/icons';
import { AssistantCopyAction } from './assistant-copy-action';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';
import type { AssistantMessage } from '../../lib/use-assistant';

export function AssistantMessageFooter({
  message,
  onEdit,
  onRewind,
}: {
  message: AssistantMessage;
  onEdit: (message: AssistantMessage) => void;
  onRewind: (message: AssistantMessage) => void;
}) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const [open, setOpen] = useState<'sources' | 'usage' | null>(null);
  const panel = useId();
  return (
    <div className="assistant-message-footer">
      <div className="assistant-message-toolbar assistant-message-actions">
        {message.role === 'assistant' && message.text && (
          <AssistantCopyAction text={message.text} />
        )}
        {message.role === 'user' && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={copy.edit}
            title={copy.edit}
            onClick={() => onEdit(message)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.prune}
          title={copy.prune}
          onClick={() => onRewind(message)}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        {Boolean(message.details.references?.length) && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={copy.sources}
            aria-expanded={open === 'sources'}
            aria-controls={panel}
            onClick={() => setOpen(open === 'sources' ? null : 'sources')}
            className="assistant-source-toggle"
          >
            <Library className="h-4 w-4" />
            <span className="hidden sm:inline">{copy.sources}</span>
            <span className="sm:hidden">{copy.sourcesShort}</span>
            <span aria-hidden="true" className="text-xs tabular-nums">
              {message.details.references?.length}
            </span>
          </Button>
        )}
        {message.details.model && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={copy.usage}
            title={copy.usage}
            aria-expanded={open === 'usage'}
            aria-controls={panel}
            onClick={() => setOpen(open === 'usage' ? null : 'usage')}
          >
            <AlertCircle isAnimated={false} className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div
        id={panel}
        hidden={!open}
        role="region"
        aria-label={open === 'sources' ? copy.sources : copy.usage}
        className="assistant-message-panel"
      >
        {open === 'sources' && (
          <ul className="space-y-3">
            {message.details.references?.map((reference) => (
              <li key={reference.href} className="flex items-baseline gap-3">
                <span className="shrink-0 text-xs text-[var(--color-app-muted)]">
                  {reference.source === 'web' ? copy.web : copy.library}
                </span>
                <a
                  className="min-w-0 break-words text-[var(--color-accent-primary)] underline underline-offset-4"
                  href={reference.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {reference.title}
                </a>
              </li>
            ))}
          </ul>
        )}
        {open === 'usage' && (
          <p className="break-words text-xs text-[var(--color-app-muted)]">
            {message.details.model}
            {message.details.costUsd ? ` · USD ${message.details.costUsd}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
