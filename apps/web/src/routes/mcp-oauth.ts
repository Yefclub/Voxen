import { Hono, type Context } from 'hono';
import { auth } from '../lib/auth';
import { mcpProtectedResourceMetadata } from '../lib/mcp-oauth';

export const mcpOAuthDiscoveryRoutes = new Hono();

function metadataResponse(c: Context): Response {
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  c.header('Content-Type', 'application/json');
  return c.json(mcpProtectedResourceMetadata());
}

mcpOAuthDiscoveryRoutes.get('/.well-known/oauth-protected-resource', metadataResponse);
mcpOAuthDiscoveryRoutes.get('/.well-known/oauth-protected-resource/mcp', metadataResponse);

// RFC 8414 appends the issuer path after the well-known segment. Better Auth
// owns the canonical metadata object but mounts its server-only helper below
// /api/auth, so this alias makes the issuer discoverable by generic MCP clients.
mcpOAuthDiscoveryRoutes.get('/.well-known/oauth-authorization-server/api/auth', async (c) => {
  const metadata = await auth.api.getOAuthServerConfig();
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return c.json(metadata);
});
