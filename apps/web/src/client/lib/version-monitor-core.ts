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
