import { ChevronDown, ExternalLink } from '@/components/ui/icons';
import { formatDateTime, formatUsd } from '../../lib/format';
import type { Locale, TranslateFn } from '../../lib/i18n';
import { safeExternalCitationUrl, type TranscriptEnrichment } from './additional-context-block';

export function ResearchEvidence({
  item,
  locale,
  t,
}: {
  item: TranscriptEnrichment;
  locale: Locale;
  t: TranslateFn;
}): React.ReactElement {
  const sourceCount = item.citations.filter((citation) =>
    safeExternalCitationUrl(citation.url),
  ).length;
  return (
    <details className="group border-y border-[var(--color-app-border)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-[var(--color-app-subtle)] hover:text-[var(--color-app-fg)]">
        {t('research.evidence')}
        <span className="flex items-center gap-2 text-xs font-normal text-[var(--color-app-muted)]">
          {t(sourceCount === 1 ? 'research.sourceOne' : 'research.sourceCount', {
            count: sourceCount,
          })}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </span>
      </summary>
      <div className="space-y-5 pb-5 text-sm text-[var(--color-app-subtle)]">
        {item.citations.flatMap((citation, index) => {
          const href = safeExternalCitationUrl(citation.url);
          if (!href) return [];
          return (
            <div key={`${href}-${index}`} className="space-y-2">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 max-w-full items-center gap-2 break-words font-medium text-[var(--color-accent-primary)] underline underline-offset-4"
              >
                <span className="min-w-0 break-words">
                  {citation.title || new URL(href).hostname}
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <blockquote className="border-l border-[var(--color-app-border-strong)] pl-4 leading-6">
                {citation.excerpt}
              </blockquote>
              {citation.retrievedAt && (
                <p className="text-xs text-[var(--color-app-muted)]">
                  {t('research.retrieved', {
                    date: formatDateTime(new Date(citation.retrievedAt), locale),
                  })}
                </p>
              )}
            </div>
          );
        })}
        {item.rationale && (
          <p className="leading-6">
            <strong>{t('library.additionalContextWhy')}</strong> {item.rationale}
          </p>
        )}
        {item.queries.length > 0 && (
          <div>
            <h4 className="font-medium">{t('research.queries')}</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {item.queries.map((query, index) => (
                <li key={index}>{query}</li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 border-t border-[var(--color-app-border)] pt-4">
          <dt>{t('research.cost')}</dt>
          <dd className="tabular-nums">
            {item.costUsd == null ? t('research.costUnknown') : formatUsd(item.costUsd, locale)}
          </dd>
          <dt>{t('research.tokens')}</dt>
          <dd className="tabular-nums">
            {(item.tokensIn ?? 0).toLocaleString(locale)} /{' '}
            {(item.tokensOut ?? 0).toLocaleString(locale)}
          </dd>
          <dt>{t('research.calls')}</dt>
          <dd>
            {t('research.callCounts', {
              search: item.searchCallCount ?? 0,
              fetch: item.fetchCallCount ?? 0,
            })}
          </dd>
          {item.model && (
            <>
              <dt>{t('research.model')}</dt>
              <dd className="break-words">{item.model}</dd>
            </>
          )}
          {item.expiresAt && (
            <>
              <dt>{t('research.expires')}</dt>
              <dd>{formatDateTime(new Date(item.expiresAt), locale)}</dd>
            </>
          )}
        </dl>
        {(item.warnings?.length ?? 0) > 0 && <p>{t('research.partial')}</p>}
      </div>
    </details>
  );
}
