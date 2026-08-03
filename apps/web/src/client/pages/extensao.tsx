import {
  CheckCircle2,
  Download,
  Link2,
  Puzzle,
  RefreshCw,
  Sparkles,
  Zap,
} from '@/components/ui/icons';
import { Button } from '../components/ui/button';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { useI18n } from '../lib/i18n';

const ZIP_HREF = '/extension/voxen-extension.zip';

export function ExtensaoPage(): React.ReactElement {
  const { t } = useI18n();
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://sua-instancia.exemplo';

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={t('extension.eyebrow')}
        icon={Puzzle}
        iconClassName="text-emerald-300"
        title={t('extension.title')}
        description={t('extension.description')}
      />

      <div className="relative overflow-hidden rounded-3xl border border-[var(--color-app-border)] bg-gradient-to-br from-[var(--color-app-surface)]/80 to-[var(--color-app-bg-elevated)]/60 p-6 shadow-xl sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Download className="h-5 w-5 text-emerald-400" />
              {t('extension.downloadTitle')}
            </h2>
            <p className="max-w-md text-sm text-[var(--color-app-muted)]">
              {t('extension.downloadDescription')}
            </p>
            <p className="text-xs text-[var(--color-app-muted)]">{t('extension.downloadHint')}</p>
          </div>
          <Button
            asChild
            size="lg"
            className="shrink-0 gap-2 rounded-2xl px-6 shadow-lg shadow-emerald-500/10"
          >
            <a href={ZIP_HREF} download="voxen-extension.zip">
              <Download className="h-4 w-4" />
              {t('extension.downloadCta')}
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Zap,
            title: t('extension.feature.fastTitle'),
            body: t('extension.feature.fastBody'),
            color: 'text-amber-300',
          },
          {
            icon: Sparkles,
            title: t('extension.feature.summaryTitle'),
            body: t('extension.feature.summaryBody'),
            color: 'text-violet-300',
          },
          {
            icon: RefreshCw,
            title: t('extension.feature.updateTitle'),
            body: t('extension.feature.updateBody'),
            color: 'text-sky-300',
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/40 p-4"
          >
            <item.icon className={`mb-3 h-5 w-5 ${item.color}`} />
            <h3 className="text-sm font-semibold tracking-tight">{item.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-app-muted)]">
              {item.body}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/30 p-6 sm:p-7">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          {t('extension.installTitle')}
        </h2>
        <ol className="space-y-3 text-sm leading-relaxed text-[var(--color-app-subtle)]">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-300">
              1
            </span>
            <span>{t('extension.install.step1')}</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-300">
              2
            </span>
            <span>{t('extension.install.step2')}</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-300">
              3
            </span>
            <span>{t('extension.install.step3')}</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-300">
              4
            </span>
            <span>
              {t('extension.install.step5Prefix')}{' '}
              <code className="rounded-md bg-[var(--color-app-surface-hover)] px-1.5 py-0.5 font-mono text-[12px] text-emerald-300">
                {baseUrl}
              </code>{' '}
              {t('extension.install.detectHint')}
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-300">
              5
            </span>
            <span>{t('extension.install.step6')}</span>
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 text-sm text-[var(--color-app-muted)]">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <p>{t('extension.authBody')}</p>
        </div>
      </div>
    </PageShell>
  );
}
