import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

/**
 * Botão de voltar flutuante do mobile (<md). O `Topbar` não hospeda
 * navegação (é só tema/chat/avatar), então este botão sobrepõe o conteúdo no
 * canto superior esquerdo pra dar o "voltar" em sub-páginas. NÃO é uma barra
 * de largura total — é um alvo compacto (≥40px) com fundo translúcido + blur
 * pra legibilidade sobre qualquer conteúdo.
 *
 * Quem decide se renderiza é o AppLayout (via `showsMobileBack`/`hasOwnMobileChrome`).
 * Nunca aparece junto com `MobileMenuButton` (mesma posição/tamanho, mutuamente
 * exclusivos — ver `AppLayout`). Ação: `navigate(-1)` (volta no histórico).
 * Posiciona respeitando o safe-area-inset-top pra não colidir com o
 * notch/status bar.
 */
export function MobileBackButton(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useI18n();

  // navigate(-1) volta no histórico; em deep-link direto (sem histórico interno)
  // isso sairia do app — então cai pra home como fallback.
  const goBack = (): void => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={t('common.back')}
      title={t('common.back')}
      className="md:hidden fixed left-3 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/80 text-[var(--color-app-fg)] backdrop-blur-md shadow-lg shadow-black/20 transition-colors active:bg-[var(--color-app-surface)]"
      style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
