import { useEffect, useState } from 'react';
import { QrCode, RefreshCw, ShieldAlert, Smartphone } from '@/components/ui/icons';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from '../../lib/toast';
import { ApiError, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Spinner } from '../ui/spinner';

export function QrLoginCard(): React.ReactElement {
  const { t } = useI18n();
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [generating, setGenerating] = useState(false);

  async function generate(): Promise<void> {
    setGenerating(true);
    try {
      const response = await apiPost<{ loginUrl: string; expiresInSec: number }>(
        '/api/account/qr-login',
        {},
      );
      setLoginUrl(response.loginUrl);
      setExpiresAt(Date.now() + response.expiresInSec * 1000);
      setRemaining(response.expiresInSec);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('account.qrLogin.error'));
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!expiresAt) return;
    const tick = (): void => {
      const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds <= 0) {
        setLoginUrl(null);
        setExpiresAt(null);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display">
          <QrCode className="h-4 w-4 text-emerald-400" />
          {t('account.qrLogin.title')}
        </CardTitle>
        <CardDescription>{t('account.qrLogin.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loginUrl ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={loginUrl} size={200} level="M" marginSize={0} />
              </div>
              <p className="flex items-center gap-1.5 text-[13px] text-[var(--color-app-muted)]">
                <Smartphone className="h-3.5 w-3.5" />
                {t('account.qrLogin.scanHint')}
              </p>
              <p className="text-xs tabular-nums text-[var(--color-app-muted)]">
                {t('account.qrLogin.expiresIn', { seconds: remaining })}
              </p>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-[13px] leading-relaxed text-amber-200/90">
                {t('account.qrLogin.warning')}
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('account.qrLogin.regenerate')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-[13px] leading-relaxed text-amber-200/90">
                {t('account.qrLogin.warning')}
              </p>
            </div>
            <Button
              variant="primary"
              size="default"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? <Spinner /> : <QrCode className="h-3.5 w-3.5" />}
              {t('account.qrLogin.generate')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
