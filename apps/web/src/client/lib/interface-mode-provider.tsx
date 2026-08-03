import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiPatch } from './api';
import { useMe } from './hooks';
import {
  normalizeInterfaceMode,
  toggleInterfaceMode,
  type AppInterfaceMode,
} from './interface-mode';

type InterfaceModeContextValue = {
  interfaceMode: AppInterfaceMode;
  saving: boolean;
  setInterfaceMode: (mode: AppInterfaceMode) => Promise<void>;
  toggleInterface: () => Promise<void>;
};

const InterfaceModeContext = createContext<InterfaceModeContextValue | null>(null);

export function InterfaceModeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { data, refresh, mutate } = useMe();
  const [optimisticMode, setOptimisticMode] = useState<AppInterfaceMode | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const persistedMode = normalizeInterfaceMode(data?.user?.interfaceMode);
  const interfaceMode = optimisticMode ?? persistedMode;

  // A preference belongs to the account, so a tab that regains attention
  // revalidates /api/me instead of trusting browser-global localStorage.
  useEffect(() => {
    let refreshing = false;
    const revalidate = (): void => {
      if (document.visibilityState !== 'visible' || refreshing || savingRef.current) return;
      refreshing = true;
      void refresh().finally(() => {
        refreshing = false;
      });
    };
    window.addEventListener('focus', revalidate);
    window.addEventListener('pageshow', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('pageshow', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refresh]);

  const setInterfaceMode = useCallback(
    async (next: AppInterfaceMode) => {
      if (savingRef.current || next === interfaceMode) return;
      savingRef.current = true;
      setSaving(true);
      setOptimisticMode(next);
      try {
        await apiPatch('/api/account', { interfaceMode: next });
        mutate((current) => ({
          ...current,
          user: current.user ? { ...current.user, interfaceMode: next } : null,
        }));
        setOptimisticMode(null);
      } catch (error) {
        setOptimisticMode(null);
        throw error;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [interfaceMode, mutate],
  );

  const toggleInterface = useCallback(async () => {
    await setInterfaceMode(toggleInterfaceMode(interfaceMode));
  }, [interfaceMode, setInterfaceMode]);

  const value = useMemo(
    () => ({ interfaceMode, saving, setInterfaceMode, toggleInterface }),
    [interfaceMode, saving, setInterfaceMode, toggleInterface],
  );

  return <InterfaceModeContext.Provider value={value}>{children}</InterfaceModeContext.Provider>;
}

export function useInterfaceMode(): InterfaceModeContextValue {
  const context = useContext(InterfaceModeContext);
  if (!context) throw new Error('useInterfaceMode must be used within InterfaceModeProvider');
  return context;
}
