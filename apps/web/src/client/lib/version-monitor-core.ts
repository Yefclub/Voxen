// Lógica pura do monitor de versão — sem DOM, sem service worker, sem React.
// Os efeitos (fetch, toast, reload, localStorage) ficam na borda em
// use-version-monitor.ts. Isto aqui é 100% testável via `bun test`.

export interface VersionPayload {
  version?: string;
  gitSha?: string | null;
}

export const UPDATE_SNOOZE_MS = 30 * 60_000;

export interface StoredVersionSnooze {
  build: string;
  until: number;
}

export function createVersionSnooze(build: string, now = Date.now()): StoredVersionSnooze {
  return { build, until: now + UPDATE_SNOOZE_MS };
}

export function parseVersionSnooze(raw: string | null): StoredVersionSnooze | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredVersionSnooze>;
    if (
      typeof parsed.build !== 'string' ||
      parsed.build.length === 0 ||
      typeof parsed.until !== 'number' ||
      !Number.isFinite(parsed.until)
    ) {
      return null;
    }
    return { build: parsed.build, until: parsed.until };
  } catch {
    return null;
  }
}

/**
 * Identidade do build servido. O servidor injeta o `gitSha` quando disponível,
 * senão a `version` — mesma ordem usada no `meta voxen-build` (index.ts).
 */
export function resolveServerBuild(payload: VersionPayload): string | null {
  return payload.gitSha || payload.version || null;
}

/**
 * Evita exibir transições redundantes como `v1.2.3 → v1.2.3` quando a
 * identidade técnica mudou (ou há um service worker esperando), mas a versão
 * amigável continuou igual.
 */
export function resolveDisplayedFromVersion(
  loadedVersion: string | null,
  serverVersion: string | null,
): string | null {
  if (!loadedVersion || loadedVersion === serverVersion) return null;
  return loadedVersion;
}

export interface ShouldNotifyArgs {
  /** Build servido agora (gitSha || version). */
  serverBuild: string | null;
  /** Build do bundle carregado nesta aba (meta voxen-build, ou baseline em dev). */
  loadedBuild: string | null;
  /** Há um service worker novo baixado, mas ainda não ativado. */
  waitingServiceWorker?: boolean;
  /** Build temporariamente adiado. */
  snoozedBuild: string | null;
  /** Instante em epoch ms até o qual o adiamento vale. */
  snoozedUntil: number | null;
  /** Relógio injetável para teste. */
  now?: number;
}

/**
 * Decide se o toast de "nova versão" deve aparecer.
 *
 * Verdadeiro SÓ quando o build servido:
 *  - existe,
 *  - não está dentro de um adiamento temporário ainda válido, E
 *  - difere do build carregado nesta aba OU há um service worker esperando.
 */
export function shouldNotify({
  serverBuild,
  loadedBuild,
  waitingServiceWorker = false,
  snoozedBuild,
  snoozedUntil,
  now = Date.now(),
}: ShouldNotifyArgs): boolean {
  if (!serverBuild) return false;
  if (serverBuild === snoozedBuild && snoozedUntil !== null && snoozedUntil > now) return false;
  return waitingServiceWorker || serverBuild !== loadedBuild;
}
