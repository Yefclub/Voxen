import { CheckCircle2, Download, Link2, Puzzle, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { AnimatedPage } from '../components/motion/animated-page';
import { Button } from '../components/ui/button';
import { useI18n } from '../lib/i18n';

const ZIP_HREF = '/extension/voxen-extension.zip';

export function ExtensaoPage(): React.ReactElement {
  const { t } = useI18n();
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://sua-instancia.exemplo';

  return (
    <AnimatedPage>
      <div className="relative mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/2 h-56 w-[min(100%,36rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(52,211,153,0.18),transparent)] blur-2xl"
        />

        <div className="relative space-y-4 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-300">
            <Puzzle className="h-3.5 w-3.5" />
            {t('extension.eyebrow')}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('extension.title')}
          </h1>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-[var(--color-app-muted)] sm:mx-0">
            {t('extension.description')}
          </p>
        </div>

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
      </div>
    </AnimatedPage>
  );
}
