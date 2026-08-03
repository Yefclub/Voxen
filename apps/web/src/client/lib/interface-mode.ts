export const INTERFACE_MODES = ['classic', 'focus'] as const;
export type AppInterfaceMode = (typeof INTERFACE_MODES)[number];

export const DEFAULT_INTERFACE_MODE: AppInterfaceMode = 'classic';

export function normalizeInterfaceMode(value: unknown): AppInterfaceMode {
  return value === 'focus' ? 'focus' : DEFAULT_INTERFACE_MODE;
}

export function toggleInterfaceMode(mode: AppInterfaceMode): AppInterfaceMode {
  return mode === 'focus' ? 'classic' : 'focus';
}
