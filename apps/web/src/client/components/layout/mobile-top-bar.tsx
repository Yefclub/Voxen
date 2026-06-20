import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Menu } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { showsMobileBack } from '../../lib/mobile-nav';

/**
 * Barra superior mobile do shell (`md:hidden`). Substitui o header (Topbar), que
 * agora é desktop-only. Enxuta: respeita `safe-area-inset-top` e hospeda dois
 * controles:
 *
 * - **Menu** (à esquerda): abre o drawer da sidebar. É o fallback acessível do
 *   edge-swipe — sempre presente pra alcançar os destinos únicos do drawer
 *   (dashboard, notas, automações, admin, setup) sem depender do gesto.
 * - **Voltar** (`navigate(-1)`): só em sub-páginas (rotas que não são abas do
 *   bottom-nav). Em abas de topo o slot fica vazio.
 *
 * Não é renderizada em rotas com chrome próprio (`/grafo`) — quem decide é o
 * `app-layout` via `hasOwnMobileChrome`.
 */
export function MobileTopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const showBack = showsMobileBack(location.pathname);

  return (
    <div
      className="md:hidden flex h-12 shrink-0 items-center gap-1 px-2"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-zinc-100 active:bg-[var(--color-app-surface-hover)]"
        aria-label={t('shell.openMenu')}
        title={t('shell.openMenu')}
      >
        <Menu className="h-5 w-5" />
      </button>

      {showBack && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface)] hover:text-zinc-100 active:bg-[var(--color-app-surface-hover)]"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t('common.back')}</span>
        </button>
      )}
    </div>
  );
}
