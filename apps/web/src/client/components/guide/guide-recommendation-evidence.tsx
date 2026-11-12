import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, Network } from '@/components/ui/icons';
import type {
  PersonalGuideRecommendation,
  PersonalGuideReason,
  PersonalGuideSource,
} from '../../../lib/personal-guide';
import { Badge } from '../ui/badge';
import { useI18n } from '../../lib/i18n';
import { formatGuidePercent, formatGuideSignedPercent } from '../../lib/personal-guide-format';

export function GuideRecommendationEvidence({
  recommendation,
  evidenceSources,
}: {
  recommendation: PersonalGuideRecommendation;
  evidenceSources: Map<string, PersonalGuideSource>;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <details className="group mt-4 border-t border-[var(--color-app-border)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)]">
        <Network className="h-3.5 w-3.5 text-[var(--color-accent-primary)]" />
        <span className="flex-1">{t('guide.rankingDetails')}</span>
        <ArrowRight className="h-3.5 w-3.5 text-[var(--color-app-muted)] transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-4 border-t border-[var(--color-app-border)] py-3">
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <Metric
            label={t('guide.rankingScore')}
            value={formatGuidePercent(recommendation.score)}
          />
          <Metric
            label={t('guide.personalizedScore')}
            value={formatGuidePercent(recommendation.personalizedScore)}
          />
          <Metric
            label={t('guide.structuralScore')}
            value={formatGuidePercent(recommendation.structuralScore)}
          />
          <Metric
            label={t('guide.personalizationLift')}
            value={formatGuideSignedPercent(recommendation.personalizationLift)}
          />
        </div>
        <div className="space-y-3">
          {recommendation.reasons.map((reason) => (
            <ReasonEvidence
              key={`${recommendation.transcriptId}:${reason.kind}`}
              reason={reason}
              evidenceSources={evidenceSources}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="py-1">
      <p className="text-[var(--color-app-muted)]">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-[var(--color-app-fg)]">{value}</p>
    </div>
  );
}

function ReasonEvidence({
  reason,
  evidenceSources,
}: {
  reason: PersonalGuideReason;
  evidenceSources: Map<string, PersonalGuideSource>;
}): React.ReactElement {
  const { t } = useI18n();
  const label =
    reason.kind === 'INTEREST'
      ? t('guide.reason.interest', { label: reason.label })
      : reason.kind === 'COMMUNITY'
        ? t('guide.reason.community', { label: reason.community?.label ?? reason.label })
        : reason.kind === 'PERSONALIZATION'
          ? t('guide.reason.personalization')
          : t('guide.reason.structural');
  const metric =
    reason.kind === 'INTEREST'
      ? t('guide.reason.interestScore', { score: formatGuidePercent(reason.score) })
      : reason.kind === 'COMMUNITY'
        ? t('guide.reason.communityScore', {
            score: formatGuidePercent(reason.community?.cohesion ?? reason.score),
          })
        : reason.kind === 'PERSONALIZATION'
          ? t('guide.reason.personalizationScore', {
              score: formatGuideSignedPercent(reason.score),
            })
          : t('guide.reason.structuralScore', { score: formatGuidePercent(reason.score) });
  const sources = [...new Set(reason.evidenceTranscriptIds)]
    .map((transcriptId) => evidenceSources.get(transcriptId))
    .filter((source): source is PersonalGuideSource => Boolean(source));

  return (
    <div className="border-t border-[var(--color-app-border)] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-[var(--color-app-subtle)]">{label}</p>
        <Badge variant="muted">{metric}</Badge>
      </div>
      {sources.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
            {t('guide.reason.supportingSources')}
          </p>
          {sources.map((source) => (
            <Link
              key={source.transcriptId}
              to={`/transcricoes/${source.transcriptId}`}
              className="flex items-center gap-2 text-xs text-[var(--color-app-subtle)] hover:text-[var(--color-app-fg)]"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{source.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
