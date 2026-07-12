// Deriva o ambiente (dev/produção) da instância a partir da string de versão
// exposta por `GET /api/version`. Lógica pura — sem DOM, sem fetch, sem React —
// pra ficar 100% testável via `bun test`.
//
// Builds de dev (Easypanel source deploy, branch `dev`) carregam a versão no
// formato `X.Y.(Z+1)-dev.<unix_ts>` (ver `formatDevVersionFromDeploy` em
// apps/web/src/index.ts). Uma release publicada carrega semver "limpo", sem
// esse sufixo (ex.: `0.11.0`). A presença do marcador `-dev.` é o único
// critério usado aqui pra distinguir os dois ambientes.

export type VersionEnvironment = 'dev' | 'prod';

const DEV_MARKER = '-dev.';

/**
 * Verdadeiro quando `version` carrega o marcador de build de dev. Valores
 * ausentes/vazios (string vazia, `undefined`) são tratados como produção —
 * nunca lançam.
 */
export function isDevVersion(version: string | null | undefined): boolean {
  return typeof version === 'string' && version.includes(DEV_MARKER);
}

/** Ambiente derivado de `version`: `'dev'` quando `isDevVersion`, senão `'prod'`. */
export function resolveVersionEnvironment(version: string | null | undefined): VersionEnvironment {
  return isDevVersion(version) ? 'dev' : 'prod';
}
