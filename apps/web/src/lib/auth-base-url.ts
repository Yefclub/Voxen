const FALLBACK_BASE_URL = 'http://localhost:3000';

/**
 * Resolve the public Better Auth base URL without propagating the opaque
 * `Invalid base URL` exception when development configuration is absent or
 * malformed. Production still fails fast in scripts/easypanel-entrypoint.sh.
 */
export function resolveAuthBaseURL(raw: string | undefined): string {
  if (!raw || raw.length === 0) return FALLBACK_BASE_URL;
  try {
    const url = new URL(raw);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0) {
      return raw;
    }
    console.error(
      `[auth] APP_BASE_URL inválido (esquema/host): '${raw}'. Usando fallback ${FALLBACK_BASE_URL}.`,
    );
  } catch {
    console.error(
      `[auth] APP_BASE_URL malformado: '${raw}'. Usando fallback ${FALLBACK_BASE_URL}.`,
    );
  }
  return FALLBACK_BASE_URL;
}
