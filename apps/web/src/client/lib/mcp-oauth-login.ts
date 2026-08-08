export function mcpOAuthSsoCallback(oauthQuery: string | null | undefined): string | null {
  if (!oauthQuery) return null;
  return `/api/auth/oauth2/authorize?${oauthQuery}`;
}
