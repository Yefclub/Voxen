// Context React pra compartilhar estado do chat (uso de contexto + último
// resumo de compactação) com o Topbar — assim o ContextBar fica fixo no
// header próximo do avatar do user, em vez de poluir o layout do chat.

import { createContext, useContext, useMemo, useState } from 'react';

export interface ChatContextUsage {
  tokens: number;
  limit: number;
}

export interface ChatCompactionInfo {
  summary: string;
  tokens_before: number;
  tokens_after: number;
  limit: number;
  cost_usd: string;
}

interface ChatContextValue {
  usage: ChatContextUsage | null;
  setUsage: (u: ChatContextUsage | null) => void;
  lastCompaction: ChatCompactionInfo | null;
  setLastCompaction: (c: ChatCompactionInfo | null) => void;
  // Sinal pra abrir o modal — chat.tsx assina e abre quando muda
  openSummarySignal: number;
  requestOpenSummary: () => void;
}

const Ctx = createContext<ChatContextValue | null>(null);

export function ChatContextProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [usage, setUsage] = useState<ChatContextUsage | null>(null);
  const [lastCompaction, setLastCompaction] = useState<ChatCompactionInfo | null>(null);
  const [openSummarySignal, setOpenSummarySignal] = useState(0);

  const value = useMemo<ChatContextValue>(
    () => ({
      usage,
      setUsage,
      lastCompaction,
      setLastCompaction,
      openSummarySignal,
      requestOpenSummary: () => setOpenSummarySignal((s) => s + 1),
    }),
    [usage, lastCompaction, openSummarySignal],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatContextState(): ChatContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChatContextState fora de ChatContextProvider');
  return v;
}
