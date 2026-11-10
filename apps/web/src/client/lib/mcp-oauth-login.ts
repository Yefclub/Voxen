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

/** Where a failed SSO login returns, keeping a pending authorization. */
export function mcpOAuthSsoErrorCallback(oauthQuery: string | null | undefined): string {
  return oauthQuery ? `/entrar?${oauthQuery}` : '/entrar';
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

/**
 * The pending authorization to resume for a user who is already signed in, or
 * null when it must show the login form instead: `prompt=login|create` or a
 * `max_age` make the authorize endpoint send the browser back to the login
 * page even with a session, so resuming them would loop.
 */
export function resumableAuthorization(search: string): string | null {
  const query = pendingOAuthQuery(search);
  if (!query) return null;
  const params = new URLSearchParams(query);
  const prompts = (params.get('prompt') ?? '').split(/\s+/);
  if (prompts.includes('login') || prompts.includes('create')) return null;
  if (params.has('max_age')) return null;
  return mcpOAuthSsoCallback(query);
}
