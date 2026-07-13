import { PanelLeftOpen } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

/**
 * Botão flutuante que abre o drawer de navegação no mobile (<md), exibido só
 * na rota de chat (`/` e `/chat`) — lá a bottom-nav fica oculta (o rodapé é o
 * promptbox) e o drawer vira o único acesso à navegação lateral. Mesmo
 * Ocupa o mesmo canto do `MobileBackButton`, mas usa um alvo mais compacto na
 * rota de chat. Os dois nunca aparecem juntos: rotas com botão de voltar são
 * sub-páginas, nunca a rota de chat (ver `AppLayout`, `showMobileNavButton`).
 */
export function MobileMenuButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('shell.openMenu')}
      title={t('shell.openMenu')}
      className="fixed left-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/75 text-[var(--color-app-fg)] shadow-sm shadow-black/10 backdrop-blur-md transition-colors active:bg-[var(--color-app-surface)] md:hidden"
    >
      <PanelLeftOpen className="h-4 w-4" />
    </button>
  );
}
