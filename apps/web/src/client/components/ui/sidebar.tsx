import {
  createContext,
  useContext,
  useEffect,
  type ComponentProps,
  type CSSProperties,
} from 'react';
import { useSidebarCollapsed } from '../../lib/sidebar-state';
import { cn } from '../../lib/utils';

// Adapted from shadcn/ui's controlled sidebar composition. Voxen owns the
// existing persisted state, tokens and mobile navigation.
export const SIDEBAR_WIDTH = 264;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
const SidebarContext = createContext<ReturnType<typeof useSidebarCollapsed> | null>(null);

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error('Sidebar requires SidebarProvider');
  return value;
}

export function SidebarProvider({ children, style, ...props }: ComponentProps<'div'>) {
  const state = useSidebarCollapsed();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'b' ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        !window.matchMedia('(min-width: 768px)').matches
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      event.preventDefault();
      state.toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.toggle]);
  return (
    <SidebarContext.Provider value={state}>
      <div
        {...props}
        data-sidebar-state={state.collapsed ? 'collapsed' : 'expanded'}
        style={
          {
            '--sidebar-width': `${state.collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH}px`,
            ...style,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ className, ...props }: ComponentProps<'aside'>) {
  const { collapsed } = useSidebar();
  return (
    <aside
      {...props}
      data-slot="sidebar"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'desktop-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] md:flex',
        className,
      )}
    />
  );
}

export function SidebarInset({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'desktop-sidebar-inset relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-app-bg)] md:overflow-hidden',
        className,
      )}
    />
  );
}

export function SidebarHeader(props: ComponentProps<'div'>) {
  return <div data-sidebar="header" {...props} />;
}
export function SidebarContent(props: ComponentProps<'nav'>) {
  return <nav data-sidebar="content" {...props} />;
}
export function SidebarFooter(props: ComponentProps<'div'>) {
  return <div data-sidebar="footer" {...props} />;
}
