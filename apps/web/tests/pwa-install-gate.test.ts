import { describe, expect, test } from 'bun:test';
import { shouldOfferInstall } from '../src/client/components/pwa-install-prompt';

describe('PWA install offer gate', () => {
  test('offers installation inside the app', () => {
    expect(shouldOfferInstall('/transcricoes', false)).toBe(true);
    expect(shouldOfferInstall('/capturar', false)).toBe(true);
  });

  test('never offers it during login or the MCP OAuth consent', () => {
    for (const path of ['/entrar', '/cadastro', '/pendente', '/oauth/consent', '/oauth']) {
      expect(shouldOfferInstall(path, false)).toBe(false);
    }
  });

  test('does not treat a lookalike route as an auth route', () => {
    expect(shouldOfferInstall('/oauthx', false)).toBe(true);
    expect(shouldOfferInstall('/entrarx', false)).toBe(true);
  });

  test('never offers it in a window opened by another app', () => {
    expect(shouldOfferInstall('/transcricoes', true)).toBe(false);
  });
});
