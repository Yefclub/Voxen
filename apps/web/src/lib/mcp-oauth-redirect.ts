const loopbacks = new Set(['127.0.0.1', '[::1]', 'localhost']);
/** Exact registered redirects; RFC 8252 allows only a different port on the same loopback callback. */
export function validateMcpOAuthRedirect(value: string, registered: readonly string[]): boolean {
  try {
    const requested = new URL(value);
    if (requested.username || requested.password || requested.hash || value.includes('*'))
      return false;
    if (registered.includes(value))
      return (
        requested.protocol === 'https:' ||
        (requested.protocol === 'http:' && loopbacks.has(requested.hostname))
      );
    if (requested.protocol !== 'http:' || !loopbacks.has(requested.hostname)) return false;
    return registered.some((entry) => {
      const candidate = new URL(entry);
      return (
        candidate.protocol === 'http:' &&
        candidate.hostname === requested.hostname &&
        candidate.pathname === requested.pathname &&
        candidate.search === requested.search &&
        !candidate.username &&
        !candidate.password &&
        !candidate.hash
      );
    });
  } catch {
    return false;
  }
}
