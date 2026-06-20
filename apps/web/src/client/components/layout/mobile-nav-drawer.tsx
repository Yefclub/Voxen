import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { MeUser } from '../../lib/types';
import { useI18n } from '../../lib/i18n';
import { SidebarModeBody, SidebarSignOut, SidebarVersionInfo } from './sidebar';

/**
 * Drawer de navegação mobile (<md). Abaixo de 768px a sidebar desktop NÃO é
 * montada — este drawer (+ bottom-nav) é a navegação do shell. Cobre a tela
 * inteira no mobile e reaproveita o corpo modo-aware da sidebar (nav |
 * conversas do chat | árvore de notas) e o botão Sair, então qualquer item
 * novo aparece automaticamente aqui também.
 *
 * Abre via botão hambúrguer (topbar) ou swipe da borda esquerda → direita.
 * Fecha em: mudança de rota, clique no backdrop, botão X, swipe de volta e
 * tecla Escape. (Swipe é tratado no AppLayout via useEdgeSwipe.)
 */
export function MobileNavDrawer({
  user,
  open,
  onClose,
}: {
  user: MeUser;
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const location = useLocation();
  const panelRef = useRef<HTMLElement>(null);

  // Navegou (NavLink/botões internos mudam a rota) → fecha o drawer.
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    if (pathRef.current === location.pathname) return;
    pathRef.current = location.pathname;
    onClose();
  }, [location.pathname, onClose]);

  // Escape fecha enquanto aberto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Foco vai pro painel ao abrir (Escape e leitores de tela funcionam direto).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Trava o scroll do body enquanto aberto — sem isso, em telas longas o
  // conteúdo de fundo rola por trás do backdrop (scroll-bleed no touch).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="mobile-nav-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
          aria-hidden
        />
      )}
      {open && (
        <motion.aside
          key="mobile-nav-panel"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t('shell.menu')}
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="md:hidden fixed inset-0 z-50 flex w-full flex-col border-r border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/98 backdrop-blur-xl overflow-hidden focus:outline-none"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="flex items-center h-16 px-4 border-b border-[var(--color-app-border)] shrink-0">
            <div className="relative shrink-0 h-9 w-9">
              <img
                src="/voxen-256.png"
                alt="Voxen"
                width={36}
                height={36}
                draggable={false}
                className="rounded-lg select-none pointer-events-none"
              />
            </div>
            <div className="ml-3 flex min-w-0 flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight font-display">Voxen</span>
              <span className="mt-1 whitespace-nowrap text-[9px] uppercase tracking-[0.04em] text-[var(--color-app-muted)]">
                {t('shell.knowledgeBase')}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto flex items-center justify-center h-7 w-7 rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface)] transition-colors"
              aria-label={t('shell.closeMenu')}
              title={t('shell.closeMenu')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* LayoutGroup com id próprio escopa os layoutId (pill/dot) deste
              drawer. No mobile a sidebar desktop nem é montada, mas o escopo é
              defensivo: garante que o motion nunca tente animar a pill entre o
              drawer e uma futura sidebar montada simultaneamente. */}
          <LayoutGroup id="mobile-nav">
            <SidebarModeBody user={user} />
          </LayoutGroup>
          <SidebarVersionInfo />
          <SidebarSignOut />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
