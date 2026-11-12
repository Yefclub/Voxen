import { useEffect } from 'react';

/** Keep installed-phone sheets and the app shell inside the visible viewport. */
export function useViewportMetrics(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    let width = window.innerWidth;
    let fullHeight = window.innerHeight;
    let keyboard = false;
    const measure = (): void => {
      frame = 0;
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        fullHeight = window.innerHeight;
      }
      fullHeight = Math.max(fullHeight, window.innerHeight);
      const active = document.activeElement;
      const editing =
        active instanceof HTMLElement &&
        active.matches('input, textarea, [contenteditable="true"]');
      keyboard = (editing || keyboard) && fullHeight - viewport.height > 150;
      root.dataset.keyboard = keyboard ? 'open' : 'closed';
      root.style.setProperty('--visual-viewport-height', `${Math.round(viewport.height)}px`);
      root.style.setProperty(
        '--visual-viewport-bottom',
        `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
      if (keyboard && active instanceof HTMLElement && active.matches('input, textarea')) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };
    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      delete root.dataset.keyboard;
      root.style.removeProperty('--visual-viewport-height');
      root.style.removeProperty('--visual-viewport-bottom');
    };
  }, []);
}
