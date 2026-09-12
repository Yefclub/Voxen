import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  LineChart,
  Network,
  RefreshCw,
  Sparkles,
} from '@/components/ui/icons';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { GuideRecommendationEvidence } from '../components/guide/guide-recommendation-evidence';
import { FetchError } from '../components/ui/fetch-error';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Spinner } from '../components/ui/spinner';
import { formatRelative } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { useI18n, type I18nKey } from '../lib/i18n';
import { formatGuidePercent, formatGuideSignedPercent } from '../lib/personal-guide-format';
import { cn } from '../lib/utils';
import type {
  PersonalGuide,
  PersonalGuideTrend,
  PersonalGuideTrendClassification,
} from '../../lib/personal-guide';

const TREND_GROUPS: Array<{
  classification: PersonalGuideTrendClassification;
  title: I18nKey;
  description: I18nKey;
  accent: string;
}> = [
  {
    classification: 'EMERGING',
    title: 'guide.trend.emerging',
    description: 'guide.trend.emergingDescription',
    accent: 'text-emerald-300',
  },
  {
    classification: 'STEADY',
    title: 'guide.trend.steady',
    description: 'guide.trend.steadyDescription',
    accent: 'text-violet-300',
  },
  {
    classification: 'COOLING',
    title: 'guide.trend.cooling',
    description: 'guide.trend.coolingDescription',
    accent: 'text-amber-300',
  },
];

export function GuiaPage(): React.ReactElement {
  const { locale, t } = useI18n();
  const { data, loading, error, refresh } = useFetch<PersonalGuide>('/api/guide');
  const empty = Boolean(data && data.trends.length === 0 && data.recommendations.length === 0);
  const evidenceSources = new Map(
    data?.evidenceSources.map((source) => [source.transcriptId, source]) ?? [],
  );

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={t('guide.eyebrow')}
        icon={LineChart}
        title={t('guide.title')}
        description={t('guide.description')}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('guide.refresh')}
          </Button>
        }
      />

      {loading && !data ? (
        <div className="flex min-h-72 items-center justify-center" aria-live="polite">
          <Spinner size={22} className="text-[var(--color-accent-primary)]" />
        </div>
      ) : error && !data ? (
        <FetchError message={error} onRetry={refresh} retrying={loading} />
      ) : data ? (
        <div data-page-content className="space-y-8">
          <section className="flex flex-wrap items-center gap-2" aria-label={t('guide.evidence')}>
            <Badge variant="outline">
              {data.metadata.personalizationMode === 'durable-interest' ? (
                <Sparkles className="h-3 w-3" />
              ) : (
                <Network className="h-3 w-3" />
              )}
              {t(
                data.metadata.personalizationMode === 'durable-interest'
                  ? 'guide.personalized'
                  : 'guide.structural',
              )}
            </Badge>
            <Badge variant={data.metadata.graphTruncated ? 'warning' : 'muted'}>
              {data.metadata.graphTruncated ? t('guide.truncated') : t('guide.completeGraph')}
            </Badge>
            <span className="ml-auto text-xs text-[var(--color-app-muted)]">
              {t('guide.generated', {
                date: formatRelative(new Date(data.metadata.generatedAt), locale),
              })}
            </span>
          </section>

          <Card elevated className="border-dashed px-5 py-4">
            <div className="flex gap-3 text-sm leading-relaxed text-[var(--color-app-subtle)]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <p>{t('guide.modelDisclosure')}</p>
            </div>
            {data.metadata.graphTruncated && (
              <p className="mt-2 pl-7 text-xs leading-relaxed text-[var(--color-app-muted)]">
                {t('guide.truncatedHint')}
              </p>
            )}
          </Card>

          {empty ? (
            <GuideEmptyState />
          ) : (
            <>
              <section className="space-y-4" aria-labelledby="guide-trends-title">
                <SectionHeading
                  id="guide-trends-title"
                  title={t('guide.trendsTitle')}
                  description={t('guide.trendsDescription')}
                />
                <div className="grid gap-4 xl:grid-cols-3">
                  {TREND_GROUPS.map((group) => (
                    <TrendColumn
                      key={group.classification}
                      group={group}
                      trends={data.trends.filter(
                        (trend) => trend.classification === group.classification,
                      )}
                      evidenceSources={evidenceSources}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="guide-recommendations-title">
                <SectionHeading
                  id="guide-recommendations-title"
                  title={t('guide.recommendationsTitle')}
                  description={t('guide.recommendationsDescription')}
                />
                {data.recommendations.length === 0 ? (
                  <Card className="p-6 text-sm text-[var(--color-app-muted)]">
                    {t('guide.noRecommendations')}
                  </Card>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {data.recommendations.map((recommendation) => (
                      <Card
                        key={recommendation.transcriptId}
                        hoverable
                        className="flex min-w-0 flex-col p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
                              {recommendation.source}
                            </p>
                            <h3 className="mt-1 line-clamp-2 font-display text-lg font-semibold tracking-tight">
                              {recommendation.title}
                            </h3>
                          </div>
                          <ScoreRing score={recommendation.score} />
                        </div>
                        {recommendation.description && (
                          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[var(--color-app-muted)]">
                            {recommendation.description}
                          </p>
                        )}
                        <GuideRecommendationEvidence
                          recommendation={recommendation}
                          evidenceSources={evidenceSources}
                        />
                        <div className="mt-auto pt-5">
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/transcricoes/${recommendation.transcriptId}`}>
                              {t('guide.openSource')}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      ) : null}
    </PageShell>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <div className="space-y-1">
      <h2 id={id} className="font-display text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-app-muted)]">
        {description}
      </p>
    </div>
  );
}

function TrendColumn({
  group,
  trends,
  evidenceSources,
}: {
  group: (typeof TREND_GROUPS)[number];
  trends: PersonalGuideTrend[];
  evidenceSources: Map<string, PersonalGuide['evidenceSources'][number]>;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Card elevated className="min-w-0 p-4 sm:p-5">
      <div className="mb-4 space-y-1">
        <h3 className={cn('font-display text-base font-semibold', group.accent)}>
          {t(group.title)}
        </h3>
        <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
          {t(group.description)}
        </p>
      </div>
      <div className="space-y-2">
        {trends.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-app-border)] px-3 py-5 text-center text-xs text-[var(--color-app-muted)]">
            {t('guide.noTrendItems')}
          </p>
        ) : (
          trends
            .slice(0, 8)
            .map((trend) => (
              <TrendDetails
                key={`${trend.dimension}:${trend.key}`}
                trend={trend}
                evidenceSources={evidenceSources}
              />
            ))
        )}
      </div>
    </Card>
  );
}

function TrendDetails({
  trend,
  evidenceSources,
}: {
  trend: PersonalGuideTrend;
  evidenceSources: Map<string, PersonalGuide['evidenceSources'][number]>;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <details className="group rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/35 open:border-[var(--color-app-border-strong)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{trend.label}</span>
        <span className="text-xs tabular-nums text-[var(--color-app-muted)]">
          {formatGuidePercent(trend.score)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-4 border-t border-[var(--color-app-border)] px-3 py-3">
        <div className="space-y-2">
          <HorizonBar label={t('guide.horizon.short')} value={trend.scores.short} />
          <HorizonBar label={t('guide.horizon.medium')} value={trend.scores.medium} />
          <HorizonBar label={t('guide.horizon.long')} value={trend.scores.long} />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
            {t('guide.evidence')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {trend.evidence.explicitTranscripts > 0 && (
              <Badge variant="outline">
                {t('guide.explicitEvidence', { count: trend.evidence.explicitTranscripts })}
              </Badge>
            )}
            {trend.evidence.observedEvents > 0 && (
              <Badge variant="muted">
                {t('guide.observedEvidence', { count: trend.evidence.observedEvents })}
              </Badge>
            )}
          </div>
          {trend.evidence.transcriptIds.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {trend.evidence.transcriptIds.map((transcriptId) => {
                const source = evidenceSources.get(transcriptId);
                if (!source) return null;
                return (
                  <Link
                    key={transcriptId}
                    to={`/transcricoes/${transcriptId}`}
                    className="flex items-center gap-2 truncate text-xs text-[var(--color-app-subtle)] hover:text-[var(--color-app-fg)]"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{source.title}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function HorizonBar({ label, value }: { label: string; value: number }): React.ReactElement {
  const normalized = Math.max(0, Math.min(1, Math.abs(value)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-[var(--color-app-muted)]">
        <span>{label}</span>
        <span className="tabular-nums">{formatGuideSignedPercent(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-app-border)]">
        <div
          className={cn(
            'h-full rounded-full',
            value < 0 ? 'bg-amber-400' : 'bg-[var(--color-accent-primary)]',
          )}
          style={{ width: `${normalized * 100}%` }}
        />
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }): React.ReactElement {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10 text-xs font-semibold tabular-nums text-violet-300">
      {formatGuidePercent(score)}
    </div>
  );
}

function GuideEmptyState(): React.ReactElement {
  const { t } = useI18n();
  return (
    <Card className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)]">
        <Clock className="h-5 w-5 text-violet-300" />
      </div>
      <h2 className="mt-4 font-display text-xl font-semibold">{t('guide.emptyTitle')}</h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--color-app-muted)]">
        {t('guide.emptyDescription')}
      </p>
      <Button asChild variant="primary" className="mt-5">
        <Link to="/transcricoes">{t('guide.addContent')}</Link>
      </Button>
    </Card>
  );
}
