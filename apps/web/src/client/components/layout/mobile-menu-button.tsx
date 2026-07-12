import { PanelLeftOpen } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

/**
 * Botão flutuante que abre o drawer de navegação no mobile (<md), exibido só
 * na rota de chat (`/` e `/chat`) — lá a bottom-nav fica oculta (o rodapé é o
 * promptbox) e o drawer vira o único acesso à navegação lateral. Mesmo
 * tamanho/posição do `MobileBackButton` (canto superior esquerdo) — os dois
 * nunca aparecem juntos: rotas com botão de voltar são sub-páginas, nunca a
 * rota de chat (ver `AppLayout`, `showMobileNavButton`).
 */
export function MobileMenuButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('shell.openMenu')}
      title={t('shell.openMenu')}
      className="md:hidden fixed left-3 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/80 text-[var(--color-app-fg)] backdrop-blur-md shadow-lg shadow-black/20 transition-colors active:bg-[var(--color-app-surface)]"
      style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
    >
      <PanelLeftOpen className="h-5 w-5" />
    </button>
  );
}
