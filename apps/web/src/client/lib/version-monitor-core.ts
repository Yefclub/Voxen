// Lógica pura do monitor de versão — sem DOM, sem service worker, sem React.
// Os efeitos (fetch, toast, reload, localStorage) ficam na borda em
// use-version-monitor.ts. Isto aqui é 100% testável via `bun test`.

export interface VersionPayload {
  version?: string;
  gitSha?: string | null;
}

/**
 * Identidade do build servido. O servidor injeta o `gitSha` quando disponível,
 * senão a `version` — mesma ordem usada no `meta voxen-build` (index.ts).
 */
export function resolveServerBuild(payload: VersionPayload): string | null {
  return payload.gitSha || payload.version || null;
}

export interface ShouldNotifyArgs {
  /** Build servido agora (gitSha || version). */
  serverBuild: string | null;
  /** Build do bundle carregado nesta aba (meta voxen-build, ou baseline em dev). */
  loadedBuild: string | null;
  /** Último build que o usuário já tratou (dispensou ou acionou "Atualizar"). */
  lastHandledBuild: string | null;
}

/**
 * Decide se o toast de "nova versão" deve aparecer.
 *
 * Verdadeiro SÓ quando o build servido:
 *  - existe,
 *  - difere do build carregado nesta aba, E
 *  - difere do último build que o usuário já tratou (dispensou/acionou).
 *
 * Isso mata o loop de "reaparece várias vezes": após dispensar OU acionar, o
 * mesmo `serverBuild` fica registrado como tratado e não re-dispara. Só um build
 * REALMENTE novo (serverBuild diferente do tratado) volta a notificar.
 */
export function shouldNotify({
  serverBuild,
  loadedBuild,
  lastHandledBuild,
}: ShouldNotifyArgs): boolean {
  if (!serverBuild) return false;
  if (serverBuild === loadedBuild) return false;
  if (serverBuild === lastHandledBuild) return false;
  return true;
}

export interface UpdateMessageArgs {
  /** Versão amigável do bundle carregado (pode ser desconhecida no PWA). */
  loadedVersion?: string | null;
  /** Versão amigável servida agora. */
  serverVersion?: string | null;
}

type Translate = (
  key: 'shell.updateAvailable' | 'shell.updateAvailableTo' | 'shell.updateAvailableFromTo',
  vars?: Record<string, string | number>,
) => string;

/**
 * Texto do toast com a transição de versão:
 *  - ambas conhecidas → "Nova versão disponível (X → Y)"
 *  - só a nova        → "Nova versão disponível (Y)"
 *  - nenhuma          → texto genérico
 */
export function formatUpdateMessage(
  t: Translate,
  { loadedVersion, serverVersion }: UpdateMessageArgs,
): string {
  const to = serverVersion?.trim() || null;
  const from = loadedVersion?.trim() || null;
  if (to && from && from !== to) {
    return t('shell.updateAvailableFromTo', { from, to });
  }
  if (to) {
    return t('shell.updateAvailableTo', { to });
  }
  return t('shell.updateAvailable');
}
