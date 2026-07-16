// ============================================================================
// /qr-login — consumo do token de login por QR (spec 060)
// ============================================================================
// O celular abre esta página via QR (`/qr-login?t=<token>`). Ela verifica o
// one-time token no better-auth, que invalida o token (single-use) e seta o
// cookie de sessão neste device. Em sucesso, redireciona ao app logado.
//
// Página standalone (sem AppLayout): o device chega SEM sessão prévia.
// Mobile-first e responsiva.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ShieldX } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../components/ui/button';
import { apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import { useI18n } from '../lib/i18n';

type Phase = 'verifying' | 'success' | 'error';

export function QrLoginPage(): React.ReactElement {
  const { t } = useI18n();
  const { refresh } = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('verifying');
  // Guard contra StrictMode/double-effect: o token é single-use, então só
  // podemos chamar o verify UMA vez (a 2ª falharia legitimamente).
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const token = params.get('t');
    if (!token) {
      setPhase('error');
      return;
    }

    void (async () => {
      try {
        await apiPost('/api/auth/one-time-token/verify', { token });
        await refresh();
        setPhase('success');
        // Pequeno delay pro feedback visual antes de entrar no app.
        setTimeout(() => navigate('/', { replace: true }), 800);
      } catch {
        setPhase('error');
      }
    })();
    // Deps vazias de propósito: token é single-use, então verificamos só no
    // mount. O `startedRef` blinda contra o double-effect do StrictMode.
  }, []);

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
            {phase === 'verifying' && (
              <>
                <div className="mx-auto relative">
                  <div className="absolute inset-0 rounded-full bg-violet-500/30 blur-xl" />
                  <div className="relative flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/40">
                    <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
                  </div>
                </div>
                <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                  {t('qrLogin.verifyingTitle')}
                </h1>
                <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                  {t('qrLogin.verifyingDescription')}
                </p>
              </>
            )}

            {phase === 'success' && (
              <>
                <div className="mx-auto relative">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-xl" />
                  <div className="relative flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/40">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  </div>
                </div>
                <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                  {t('qrLogin.successTitle')}
                </h1>
                <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                  {t('qrLogin.successDescription')}
                </p>
              </>
            )}

            {phase === 'error' && (
              <>
                <div className="mx-auto relative">
                  <div className="absolute inset-0 rounded-full bg-rose-500/30 blur-xl" />
                  <div className="relative flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/40">
                    <ShieldX className="h-6 w-6 text-rose-400" />
                  </div>
                </div>
                <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">
                  {t('qrLogin.errorTitle')}
                </h1>
                <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
                  {t('qrLogin.errorDescription')}
                </p>
                <div className="pt-2">
                  <Button variant="primary" size="lg" onClick={() => navigate('/entrar')}>
                    {t('qrLogin.goToLogin')}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
