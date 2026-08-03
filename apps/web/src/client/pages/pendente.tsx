import { useNavigate } from 'react-router-dom';
import { Clock, LogOut } from '@/components/ui/icons';
import { motion } from 'motion/react';
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
      <div className="min-h-full flex flex-col">
        <main className="flex-1 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md text-center space-y-6"
          >
            <div className="mx-auto relative">
              <div className="absolute inset-0 rounded-full bg-amber-500/30 blur-xl" />
              <div className="relative flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/40">
                <Clock className="h-6 w-6 text-amber-400" />
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
          </motion.div>
        </main>
      </div>
    </div>
  );
}
