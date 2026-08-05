import { useEffect, useState } from 'react';
import { setEnabled } from 'cuelume';

// ============================================================================
// Store leve do "chrome" do chat compartilhado entre a página de chat e o shell
// (topbar/rail). Segue o padrão singleton + subscribers de `sidebar-state.ts`.
//
// - `chat.tsx` PUBLICA `streaming` e `isEmpty` e CONSOME `clearSignal` (pedido de
//   limpar conversa vindo do topbar).
// - `topbar.tsx` LÊ `streaming`/`isEmpty`/`soundsEnabled` e dispara `setSounds`
//   (som on/off) e `requestClear` (incrementa o signal), sem conhecer o chat.
// - `soundsEnabled` é a fonte única do estado de som: persiste em localStorage e
//   sincroniza o `cuelume` (o `play()` fica na UI que reage ao evento).
// ============================================================================

const SOUNDS_KEY = 'voxen.chat.sounds';

interface ChatShellState {
  soundsEnabled: boolean;
  streaming: boolean;
  isEmpty: boolean;
  sourcesOpen: boolean;
  /** Contador incremental — cada incremento é um pedido de limpar a conversa. */
  clearSignal: number;
}

const initialSounds =
  typeof window === 'undefined' ? false : window.localStorage.getItem(SOUNDS_KEY) === 'true';

// Sincroniza o cuelume com a preferência persistida logo na carga do módulo.
if (typeof window !== 'undefined') {
  try {
    setEnabled(initialSounds);
  } catch {
    /* cuelume indisponível (SSR/testes) — ignore */
  }
}

let current: ChatShellState = {
  soundsEnabled: initialSounds,
  streaming: false,
  isEmpty: true,
  sourcesOpen: false,
  clearSignal: 0,
};

const subscribers = new Set<(state: ChatShellState) => void>();

function update(patch: Partial<ChatShellState>): void {
  current = { ...current, ...patch };
  subscribers.forEach((cb) => cb(current));
}

export function setSounds(next: boolean): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SOUNDS_KEY, String(next));
    try {
      setEnabled(next);
    } catch {
      /* ignore */
    }
  }
  update({ soundsEnabled: next });
}

export function setChatStreaming(next: boolean): void {
  if (current.streaming !== next) update({ streaming: next });
}

export function setChatEmpty(next: boolean): void {
  if (current.isEmpty !== next) update({ isEmpty: next });
}

export function setChatSourcesOpen(next: boolean): void {
  if (current.sourcesOpen !== next) update({ sourcesOpen: next });
}

export function requestClearConversation(): void {
  update({ clearSignal: current.clearSignal + 1 });
}

/** Leitura imperativa do estado de som (para handlers async fora do render). */
export function getSoundsEnabled(): boolean {
  return current.soundsEnabled;
}

export function useChatShell(): ChatShellState {
  const [state, setState] = useState<ChatShellState>(current);
  useEffect(() => {
    subscribers.add(setState);
    setState(current); // sincroniza se o store mudou entre render e mount
    return () => {
      subscribers.delete(setState);
    };
  }, []);
  return state;
}
