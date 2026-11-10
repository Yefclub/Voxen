import { describe, expect, test } from 'bun:test';
import {
  mcpOAuthSsoCallback,
  mcpOAuthSsoErrorCallback,
  oauthContinuationUrl,
  pendingOAuthQuery,
  resumableAuthorization,
} from '../src/client/lib/mcp-oauth-login';

const ORIGIN = 'https://voxen.example';

describe('MCP OAuth sign-in continuation', () => {
  test('follows the consent URL a sign-in response returns', () => {
    expect(oauthContinuationUrl({ redirect: true, url: '/oauth/consent?x=1' }, ORIGIN)).toBe(
      'https://voxen.example/oauth/consent?x=1',
    );
  });

  test('follows a loopback client redirect_uri', () => {
    expect(
      oauthContinuationUrl({ redirect_uri: 'http://127.0.0.1:33418/callback?code=c' }, ORIGIN),
    ).toBe('http://127.0.0.1:33418/callback?code=c');
  });

  test('an ordinary sign-in response does not continue anywhere', () => {
    expect(oauthContinuationUrl({ user: { id: 'u' } }, ORIGIN)).toBeNull();
    expect(oauthContinuationUrl(null, ORIGIN)).toBeNull();
  });

  test('never follows a non-http target', () => {
    expect(oauthContinuationUrl({ url: 'javascript:alert(1)' }, ORIGIN)).toBeNull();
    expect(oauthContinuationUrl({ url: 'data:text/html,x' }, ORIGIN)).toBeNull();
  });

  test('only a signed better-auth query counts as a pending authorization', () => {
    expect(pendingOAuthQuery('?client_id=a&sig=b')).toBe('client_id=a&sig=b');
    expect(pendingOAuthQuery('?next=%2Fcapturar')).toBeUndefined();
    expect(mcpOAuthSsoCallback('client_id=a&sig=b')).toBe(
      '/api/auth/oauth2/authorize?client_id=a&sig=b',
    );
  });

  test('a failed SSO login returns to sign-in with the pending authorization', () => {
    expect(mcpOAuthSsoErrorCallback('client_id=a&sig=b')).toBe('/entrar?client_id=a&sig=b');
    expect(mcpOAuthSsoErrorCallback(undefined)).toBe('/entrar');
  });

  test('a signed-in user resumes a pending authorization on the server', () => {
    expect(resumableAuthorization('?client_id=a&scope=mcp%3Aread&sig=b')).toBe(
      '/api/auth/oauth2/authorize?client_id=a&scope=mcp%3Aread&sig=b',
    );
    expect(resumableAuthorization('?next=%2F')).toBeNull();
  });

  test('a request demanding a fresh login is not resumed (it would loop)', () => {
    expect(resumableAuthorization('?client_id=a&prompt=login&sig=b')).toBeNull();
    expect(resumableAuthorization('?client_id=a&prompt=consent+create&sig=b')).toBeNull();
    expect(resumableAuthorization('?client_id=a&max_age=0&sig=b')).toBeNull();
    expect(resumableAuthorization('?client_id=a&prompt=consent&sig=b')).not.toBeNull();
  });
});
