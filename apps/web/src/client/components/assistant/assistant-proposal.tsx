import { useState } from 'react';
import { Button } from '../ui/button';
import { Markdown } from '../ui/markdown';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';
import type { AssistantProposal } from '../../lib/use-assistant';

export function AssistantProposalCard({
  proposal,
  revision,
  disabled,
  onDecision,
}: {
  proposal: AssistantProposal;
  revision: number;
  disabled: boolean;
  onDecision: (id: string, confirm: boolean) => Promise<void>;
}) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = proposal.revision === revision;
  const pending = current && proposal.status === 'PENDING';
  async function decide(confirm: boolean) {
    setBusy(true);
    setError(false);
    try {
      await onDecision(proposal.id, confirm);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={copy.proposalTitle}
      className="mt-5 w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-4 sm:p-5"
    >
      <h3 className="text-sm font-semibold">
        {proposal.name === 'create_note' ? copy.proposalNote : copy.proposalCapture}
      </h3>
      <p className="mt-2 break-words text-base font-medium">
        {proposal.input.title ?? proposal.input.url}
      </p>
      {proposal.input.content && (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-[var(--color-app-muted)]">
            {copy.previewNote}
          </summary>
          <div className="max-h-64 overflow-y-auto">
            <Markdown headingOffset={2}>{proposal.input.content}</Markdown>
          </div>
        </details>
      )}
      {pending ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-app-muted)]">
            {copy.proposalHint}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={disabled || busy} onClick={() => void decide(true)}>
              {copy.confirmAddition}
            </Button>
            <Button variant="ghost" disabled={disabled || busy} onClick={() => void decide(false)}>
              {copy.dismissAddition}
            </Button>
          </div>
        </>
      ) : (
        <p role="status" className="mt-3 text-sm text-[var(--color-app-muted)]">
          {!current
            ? copy.proposalExpired
            : proposal.status === 'EXECUTED'
              ? copy.proposalExecuted
              : proposal.status === 'APPROVED'
                ? copy.proposalApproved
                : copy.proposalDismissed}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-app-danger)]">
          {copy.proposalError}
        </p>
      )}
    </section>
  );
}
