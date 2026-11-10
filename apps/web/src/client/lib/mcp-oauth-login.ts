/** The signed OAuth query better-auth appends to /entrar, if any. */
export function pendingOAuthQuery(search: string): string | undefined {
  const value = search.replace(/^\?/, '');
  return value.includes('sig=') ? value : undefined;
}

/** Where an SSO login resumes a pending MCP OAuth authorization. */
export function mcpOAuthSsoCallback(oauthQuery: string | null | undefined): string | null {
  if (!oauthQuery) return null;
  return `/api/auth/oauth2/authorize?${oauthQuery}`;
}

/**
 * The URL a sign-in response asks the page to continue to (OAuth consent or
 * the client's validated redirect), or null for an ordinary login. Only
 * http(s) targets are followed; http is needed for loopback redirect URIs.
 */
export function oauthContinuationUrl(response: unknown, origin: string): string | null {
  if (!response || typeof response !== 'object') return null;
  const value = response as { url?: unknown; redirect_uri?: unknown };
  const raw = typeof value.url === 'string' ? value.url : value.redirect_uri;
  if (typeof raw !== 'string') return null;
  try {
    const target = new URL(raw, origin);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
    return target.toString();
  } catch {
    return null;
  }
}
