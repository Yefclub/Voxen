import { useNavigate } from 'react-router-dom';
import { Clock, LogOut } from '@/components/ui/icons';
import { AuthFrame } from '../components/layout/auth-frame';
import { Button } from '../components/ui/button';
import { useMe } from '../lib/hooks';
import { apiPost } from '../lib/api';
import { useI18n } from '../lib/i18n';

export function PendentePage(): React.ReactElement {
  const { data, refresh } = useMe();
  const { t } = useI18n();
  const navigate = useNavigate();

  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  const status = data?.user?.status ?? 'PENDING';
  const isSetupIncomplete = !data?.setupComplete && data?.user?.role !== 'ADMIN';

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain">
      <AuthFrame story={false}>
        <div className="mx-auto w-full max-w-md space-y-6 text-center">
          <div className="mx-auto relative">
            <div className="relative flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/40">
              <Clock className="h-6 w-6 text-[var(--color-app-warning-fg)]" />
            </div>
          </div>

          {isSetupIncomplete ? (
            <>
              <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                {t('pending.setupTitle')}
              </h1>
              <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                {t('pending.setupDescription')}
              </p>
            </>
          ) : status === 'PENDING' ? (
            <>
              <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                {t('pending.approvalTitle')}
              </h1>
              <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                {t('pending.approvalDescription')}
              </p>
            </>
          ) : status === 'REJECTED' ? (
            <>
              <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                {t('pending.rejectedTitle')}
              </h1>
              <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                {t('pending.rejectedDescription')}
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                {t('pending.disabledTitle')}
              </h1>
              <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                {t('pending.disabledDescription')}
              </p>
            </>
          )}

          <div className="pt-2">
            <Button variant="secondary" size="lg" onClick={onSignOut}>
              <LogOut className="h-4 w-4" />
              {t('common.signOut')}
            </Button>
          </div>
        </div>
      </AuthFrame>
    </div>
  );
}
