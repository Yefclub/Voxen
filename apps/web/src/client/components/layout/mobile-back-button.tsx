import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';

export function MobileBackButton(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useI18n();

  // navigate(-1) volta no histórico; em deep-link direto (sem histórico interno)
  // isso sairia do app — então cai pra home como fallback.
  const goBack = (): void => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/transcricoes');
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t('common.back')}
      title={t('common.back')}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-app-fg)] transition-colors hover:bg-[var(--color-app-surface)] md:hidden"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
