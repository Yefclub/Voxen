import { Download, Puzzle, ShieldCheck, AppWindow } from 'lucide-react';
import { AnimatedPage } from '../components/motion/animated-page';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useI18n } from '../lib/i18n';

const ZIP_HREF = '/extension/voxen-extension.zip';

export function ExtensaoPage(): React.ReactElement {
  const { t } = useI18n();
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://sua-instancia.exemplo';

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
            <Puzzle className="h-3 w-3 text-emerald-400" />
            {t('extension.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t('extension.title')}
          </h1>
          <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
            {t('extension.description')}
          </p>
        </div>

        <Card className="border-[var(--color-app-border)] bg-[var(--color-app-surface)]/50">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4 text-emerald-400" />
              {t('extension.downloadTitle')}
            </CardTitle>
            <CardDescription>{t('extension.downloadDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="gap-2">
              <a href={ZIP_HREF} download="voxen-extension.zip">
                <Download className="h-4 w-4" />
                {t('extension.downloadCta')}
              </a>
            </Button>
            <p className="text-xs text-[var(--color-app-muted)] self-center">
              {t('extension.downloadHint')}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-app-border)] bg-[var(--color-app-surface)]/50">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <AppWindow className="h-4 w-4 text-sky-400" />
              {t('extension.installTitle')}
            </CardTitle>
            <CardDescription>{t('extension.installDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-app-subtle)] leading-relaxed">
              <li>{t('extension.install.step1')}</li>
              <li>{t('extension.install.step2')}</li>
              <li>{t('extension.install.step3')}</li>
              <li>{t('extension.install.step4')}</li>
              <li>
                {t('extension.install.step5Prefix')}{' '}
                <code className="rounded bg-[var(--color-app-surface-hover)] px-1.5 py-0.5 text-[12px] text-emerald-300">
                  {baseUrl}
                </code>
              </li>
              <li>{t('extension.install.step6')}</li>
            </ol>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-app-border)] bg-[var(--color-app-surface)]/50">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-violet-400" />
              {t('extension.authTitle')}
            </CardTitle>
            <CardDescription>{t('extension.authDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--color-app-subtle)] leading-relaxed">
            <p>{t('extension.authBody')}</p>
            <p className="text-xs text-[var(--color-app-muted)]">{t('extension.authCors')}</p>
          </CardContent>
        </Card>
      </div>
    </AnimatedPage>
  );
}
