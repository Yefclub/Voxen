import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Link2, Puzzle, ShieldCheck, Trash2 } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Spinner } from '../components/ui/spinner';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { ApiError, apiDelete, apiGet } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

interface PlatformCookieStatus {
  platform: string;
  hasCookie: boolean;
  capturedAt: string | null;
  stale: boolean;
}

/** Conta pessoal: a extensão captura no perfil de browser deste usuário. */
export function ContaPlataformasPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [platforms, setPlatforms] = useState<PlatformCookieStatus[] | null>(null);
  const [confirmPlatform, setConfirmPlatform] = useState<PlatformCookieStatus | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const response = await apiGet<{ platforms: PlatformCookieStatus[] }>(
        '/api/integrations/cookies',
      );
      setPlatforms(response.platforms);
    } catch {
      setPlatforms([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function disconnect(platform: string): Promise<void> {
    setRemoving(platform);
    try {
      await apiDelete(`/api/integrations/cookies/${platform}`);
      toast.success(t('account.platforms.disconnected'));
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <PageShell width="reading">
      <PageHeader
        eyebrow={t('account.eyebrow')}
        icon={Link2}
        iconClassName="text-amber-400"
        title={t('account.platforms.title')}
        description={t('account.platforms.description')}
      />

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Card elevated>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              {t('account.platforms.cardTitle')}
            </CardTitle>
            <CardDescription>{t('account.platforms.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {platforms === null ? (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            ) : (
              platforms.map((platform) => {
                const captured = platform.capturedAt ? new Date(platform.capturedAt) : null;
                const capturedLabel =
                  captured && !Number.isNaN(captured.getTime())
                    ? captured.toLocaleDateString(locale)
                    : null;
                return (
                  <div
                    key={platform.platform}
                    className="flex items-center gap-3 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/40 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--color-app-fg)]">
                        {PLATFORM_LABELS[platform.platform] ?? platform.platform}
                      </p>
                      <p
                        className={cn(
                          'mt-0.5 text-[11px]',
                          !platform.hasCookie && 'text-[var(--color-app-muted)]',
                          platform.hasCookie && platform.stale && 'text-amber-400',
                          platform.hasCookie && !platform.stale && 'text-emerald-400',
                        )}
                      >
                        {!platform.hasCookie
                          ? t('account.platforms.notConnected')
                          : platform.stale
                            ? t('account.platforms.stale')
                            : t('account.platforms.connected')}
                        {platform.hasCookie && capturedLabel
                          ? ` · ${t('account.platforms.capturedAt', { date: capturedLabel })}`
                          : ''}
                      </p>
                    </div>
                    {platform.hasCookie && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removing === platform.platform}
                        onClick={() => setConfirmPlatform(platform)}
                      >
                        {removing === platform.platform ? (
                          <Spinner />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {t('account.platforms.disconnect')}
                      </Button>
                    )}
                  </div>
                );
              })
            )}
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/30 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
                {t('account.platforms.captureHint')}
              </p>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link to="/extensao">
                  <Puzzle className="h-3.5 w-3.5" />
                  {t('account.platforms.openExtension')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      <ConfirmDialog
        open={confirmPlatform !== null}
        onOpenChange={(open) => !open && setConfirmPlatform(null)}
        title={t('account.platforms.disconnectTitle', {
          platform: confirmPlatform
            ? (PLATFORM_LABELS[confirmPlatform.platform] ?? confirmPlatform.platform)
            : '',
        })}
        description={t('account.platforms.disconnectDescription')}
        confirmLabel={t('account.platforms.disconnect')}
        variant="destructive"
        onConfirm={async () => {
          const target = confirmPlatform;
          setConfirmPlatform(null);
          if (target) await disconnect(target.platform);
        }}
      />
    </PageShell>
  );
}
