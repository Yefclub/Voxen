import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, ChevronUp, MessageSquare } from 'lucide-react';
import type { TranslateFn } from '../../lib/i18n';
import { cn } from '../../lib/utils';

export function TranscriptChatDock({
  value,
  onChange,
  onSend,
  title,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  title: string;
  t: TranslateFn;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const triggerPointerFocusRef = useRef(false);
  const contentId = useId();
  const hasDraft = value.trim().length > 0;

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [value]);

  function collapseIfIdle(): void {
    if (!pointerInsideRef.current && !focusInsideRef.current && !hasDraft) {
      setExpanded(false);
    }
  }

  function focusComposer(): void {
    setExpanded(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function activateTrigger(event: React.MouseEvent<HTMLButtonElement>): void {
    const hasHover =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover)').matches;
    const pointerActivation = event.detail > 0;
    triggerPointerFocusRef.current = false;

    if (pointerActivation && !hasHover && expanded && !hasDraft) {
      focusInsideRef.current = false;
      setExpanded(false);
      event.currentTarget.blur();
      return;
    }
    focusComposer();
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3">
      <div
        data-testid="transcript-chat-dock"
        className="pointer-events-auto w-full max-w-3xl pb-[max(0.5rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: expanded ? 'translateY(0)' : 'translateY(calc(100% - 2rem))' }}
        onMouseEnter={() => {
          pointerInsideRef.current = true;
          setExpanded(true);
        }}
        onMouseLeave={() => {
          pointerInsideRef.current = false;
          collapseIfIdle();
        }}
        onFocusCapture={() => {
          focusInsideRef.current = true;
          if (!triggerPointerFocusRef.current) setExpanded(true);
        }}
        onBlurCapture={(event) => {
          if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
          focusInsideRef.current = false;
          triggerPointerFocusRef.current = false;
          collapseIfIdle();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
          className="overflow-hidden rounded-2xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)]/95 shadow-xl shadow-black/20 backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-[var(--color-accent-primary)]/50 focus-within:shadow-black/30"
        >
          <button
            type="button"
            data-testid="transcript-chat-dock-trigger"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-label={t('library.chatBarExpand')}
            onPointerDown={() => {
              triggerPointerFocusRef.current = true;
            }}
            onPointerCancel={() => {
              triggerPointerFocusRef.current = false;
            }}
            onClick={activateTrigger}
            className="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] text-[var(--color-app-muted)] outline-none transition-colors hover:bg-[var(--color-app-surface)]/70 focus-visible:bg-[var(--color-app-surface)]/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent-primary)]/45"
          >
            <span className="h-1 w-7 shrink-0 rounded-full bg-[var(--color-app-border-strong)]" />
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]" />
            <span className="min-w-0 flex-1 truncate">
              {t('library.chatBarContext', { title })}
            </span>
            <ChevronUp
              aria-hidden="true"
              className={cn('h-3.5 w-3.5 shrink-0 transition-transform', expanded && 'rotate-180')}
            />
          </button>

          <div
            id={contentId}
            data-testid="transcript-chat-dock-content"
            aria-hidden={!expanded}
            inert={!expanded}
            className="flex items-end gap-2 px-2 pb-2 pt-1"
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder={t('library.chatBarPlaceholder')}
              rows={1}
              className="max-h-32 min-h-9 min-w-0 flex-1 resize-none rounded-xl bg-[var(--color-app-surface)]/65 px-3 py-2 text-sm leading-5 text-[var(--color-app-fg)] outline-none placeholder:text-[var(--color-app-muted)] focus:bg-[var(--color-app-surface)]"
            />
            <button
              type="submit"
              disabled={!hasDraft}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-accent-primary)] text-white transition-[opacity,transform] hover:scale-[1.03] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-app-bg-elevated)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 motion-reduce:transition-none"
              aria-label={t('chat.send')}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
