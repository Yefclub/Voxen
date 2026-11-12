import { useEffect, useId, useRef } from 'react';
import { useIsDesktop } from './use-media-query';

/** A phone's Back gesture dismisses the current sheet before leaving its page. */
export function useOverlayBack(open: boolean, onClose: () => void): void {
  const desktop = useIsDesktop();
  const id = useId();
  const close = useRef(onClose);
  const lifecycle = useRef(0);
  close.current = onClose;
  useEffect(() => {
    if (!open || desktop) return;
    const generation = ++lifecycle.current;
    const marker = `voxen-sheet:${id}`;
    if (window.history.state?.voxenOverlay !== marker) {
      window.history.pushState({ ...window.history.state, voxenOverlay: marker }, '');
    }
    const onPop = (): void => {
      if (window.history.state?.voxenOverlay !== marker) close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Strict Mode replays an initially open sheet's effect. Let its next
      // setup retain the marker before removing a truly dismissed entry.
      queueMicrotask(() => {
        if (lifecycle.current !== generation) return;
        if (window.history.state?.voxenOverlay === marker) window.history.back();
      });
    };
  }, [open, desktop, id]);
}
