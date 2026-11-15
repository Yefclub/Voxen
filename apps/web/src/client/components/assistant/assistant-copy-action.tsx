import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Check, Copy } from '../ui/icons';
import { writeClipboardText } from '../../lib/clipboard';
import { assistantCopy } from '../../lib/assistant-i18n';
import { useI18n } from '../../lib/i18n';

export function AssistantCopyAction({ text }: { text: string }) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const [status, setStatus] = useState<'idle' | 'copying' | 'done' | 'error'>('idle');
  useEffect(() => {
    if (status !== 'done') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  async function copyAnswer() {
    setStatus('copying');
    try {
      await writeClipboardText(text, copy.copyError);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={copy.copyAnswer}
        title={status === 'done' ? copy.copied : copy.copyAnswer}
        disabled={status === 'copying'}
        aria-busy={status === 'copying'}
        onClick={() => void copyAnswer()}
      >
        {status === 'done' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <span
        role="status"
        aria-live="polite"
        className={
          status === 'error'
            ? 'order-last basis-full text-sm text-[var(--color-app-danger)]'
            : 'sr-only'
        }
      >
        {status === 'done' ? copy.copied : status === 'error' ? copy.copyError : ''}
      </span>
    </>
  );
}
