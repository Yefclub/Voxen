export type ReleaseType = 'feat' | 'fix' | 'perf' | 'ui' | 'infra' | 'security' | 'chore';

const RELEASE_TYPE_I18N_KEYS = {
  feat: 'novidades.type.feat',
  fix: 'novidades.type.fix',
  perf: 'novidades.type.perf',
  ui: 'novidades.type.ui',
  infra: 'novidades.type.infra',
  security: 'novidades.type.security',
  chore: 'novidades.type.chore',
} as const satisfies Record<ReleaseType, string>;

export function releaseTypeI18nKey(
  type: string,
): (typeof RELEASE_TYPE_I18N_KEYS)[ReleaseType] | null {
  return Object.prototype.hasOwnProperty.call(RELEASE_TYPE_I18N_KEYS, type)
    ? RELEASE_TYPE_I18N_KEYS[type as ReleaseType]
    : null;
}
