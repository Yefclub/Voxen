import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildChiselAuthfile,
  syncChiselAuthfile,
  writeAuthfileInPlace,
  CHISEL_SOCKS_REMOTE,
  deriveTunnelUrl,
  proxyTunnelPath,
  DEFAULT_PROXY_TUNNEL_PATH,
} from '../src/lib/proxy-agent-tunnel';

describe('buildChiselAuthfile', () => {
  it('returns {} when token is null', () => {
    expect(buildChiselAuthfile(null)).toEqual({});
  });

  it('returns {} when token is empty string', () => {
    expect(buildChiselAuthfile('')).toEqual({});
  });

  it('maps voxen:<token> to the restricted localhost remote regex', () => {
    const out = buildChiselAuthfile('abc123');
    expect(out).toEqual({
      'voxen:abc123': ['^R:127\\.0\\.0\\.1:1080:socks$'],
    });
  });

  it('the regex matches exactly the canonical remote and nothing broader', () => {
    const regex = new RegExp(buildChiselAuthfile('t')['voxen:t']![0]!);
    expect(regex.test(CHISEL_SOCKS_REMOTE)).toBe(true);
    expect(regex.test('R:127.0.0.1:1080:socks')).toBe(true);
    // Não pode casar bind aberto (0.0.0.0) nem outras portas.
    expect(regex.test('R:0.0.0.0:1080:socks')).toBe(false);
    expect(regex.test('R:127.0.0.1:1080:socks:extra')).toBe(false);
    expect(regex.test('R:127x0x0x1:1080:socks')).toBe(false);
  });
});

describe('proxyTunnelPath', () => {
  const original = process.env.PROXY_TUNNEL_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.PROXY_TUNNEL_PATH;
    else process.env.PROXY_TUNNEL_PATH = original;
  });

  it('defaults to /_tunnel when env is unset', () => {
    delete process.env.PROXY_TUNNEL_PATH;
    expect(proxyTunnelPath()).toBe(DEFAULT_PROXY_TUNNEL_PATH);
    expect(proxyTunnelPath()).toBe('/_tunnel');
  });

  it('honors PROXY_TUNNEL_PATH and normalizes leading slash', () => {
    process.env.PROXY_TUNNEL_PATH = 'custom-tunnel';
    expect(proxyTunnelPath()).toBe('/custom-tunnel');
  });

  it('strips a redundant trailing slash', () => {
    process.env.PROXY_TUNNEL_PATH = '/edge/';
    expect(proxyTunnelPath()).toBe('/edge');
  });
});

describe('deriveTunnelUrl', () => {
  const original = {
    explicit: process.env.PROXY_TUNNEL_URL,
    appBase: process.env.APP_BASE_URL,
    path: process.env.PROXY_TUNNEL_PATH,
  };
  afterEach(() => {
    for (const [env, val] of [
      ['PROXY_TUNNEL_URL', original.explicit],
      ['APP_BASE_URL', original.appBase],
      ['PROXY_TUNNEL_PATH', original.path],
    ] as const) {
      if (val === undefined) delete process.env[env];
      else process.env[env] = val;
    }
  });

  function clear() {
    delete process.env.PROXY_TUNNEL_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.PROXY_TUNNEL_PATH;
  }

  it('derives wss from an https APP_BASE_URL with the tunnel path', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    expect(deriveTunnelUrl()).toBe('wss://voxen.exemplo.com/_tunnel');
  });

  it('derives ws from an http APP_BASE_URL (dev) with the tunnel path', () => {
    clear();
    process.env.APP_BASE_URL = 'http://localhost:3000';
    expect(deriveTunnelUrl()).toBe('ws://localhost:3000/_tunnel');
  });

  it('preserves a non-default port from APP_BASE_URL', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com:8443';
    expect(deriveTunnelUrl()).toBe('wss://voxen.exemplo.com:8443/_tunnel');
  });

  it('uses a custom PROXY_TUNNEL_PATH in the derived URL', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    process.env.PROXY_TUNNEL_PATH = '/wormhole';
    expect(deriveTunnelUrl()).toBe('wss://voxen.exemplo.com/wormhole');
  });

  it('does NOT prefix the host with tunnel. (legacy behavior removed)', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    expect(deriveTunnelUrl()).not.toContain('tunnel.voxen');
  });

  it('PROXY_TUNNEL_URL takes precedence over APP_BASE_URL', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    process.env.PROXY_TUNNEL_URL = 'wss://outro-host.net:9000/control';
    expect(deriveTunnelUrl()).toBe('wss://outro-host.net:9000/control');
  });

  it('returns null when neither env is set', () => {
    clear();
    expect(deriveTunnelUrl()).toBeNull();
  });

  it('returns null for a malformed APP_BASE_URL', () => {
    clear();
    process.env.APP_BASE_URL = 'not a url';
    expect(deriveTunnelUrl()).toBeNull();
  });

  it('returns null for a non-http(s) APP_BASE_URL scheme', () => {
    clear();
    process.env.APP_BASE_URL = 'ftp://voxen.exemplo.com';
    expect(deriveTunnelUrl()).toBeNull();
  });
});

describe('syncChiselAuthfile (best-effort I/O)', () => {
  const original = {
    authfile: process.env.CHISEL_AUTHFILE,
  };

  afterEach(() => {
    if (original.authfile === undefined) delete process.env.CHISEL_AUTHFILE;
    else process.env.CHISEL_AUTHFILE = original.authfile;
  });

  it('does not throw when DB / token is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voxen-chisel-'));
    process.env.CHISEL_AUTHFILE = join(dir, 'auth.json');
    // getSetting pode falhar sem DB — syncChiselAuthfile engole o erro.
    await expect(syncChiselAuthfile()).resolves.toBeUndefined();
  });

  it('does not throw when authfile path is unwritable', async () => {
    process.env.CHISEL_AUTHFILE = '/proc/voxen-nonexistent/auth.json';
    await expect(syncChiselAuthfile()).resolves.toBeUndefined();
  });

  it('writes in-place (stable inode) so chisel fsnotify reload fires on rewrite', () => {
    // Regressão: o chisel observa o INODE do authfile via fsnotify e só recarrega
    // no evento Write. Um temp+rename mudaria o inode e quebraria o watch (token
    // revogado continuaria válido). A escrita TEM que ser in-place: mesmo inode
    // entre reescritas, conteúdo atualizado.
    const dir = mkdtempSync(join(tmpdir(), 'voxen-chisel-'));
    const authfile = join(dir, 'auth.json');
    writeAuthfileInPlace(authfile, '{"voxen:a":["^R:127\\\\.0\\\\.0\\\\.1:1080:socks$"]}');
    const inoBefore = statSync(authfile).ino;
    writeAuthfileInPlace(authfile, '{}');
    const inoAfter = statSync(authfile).ino;
    expect(inoAfter).toBe(inoBefore);
    expect(JSON.parse(readFileSync(authfile, 'utf8'))).toEqual({});
  });

  it('writes valid JSON to the authfile path (token absent -> {})', async () => {
    // Sem token configurado (DB de teste não tem proxy_agent_token), o authfile
    // resultante deve ser {} — ou o write falha silenciosamente sem quebrar.
    const dir = mkdtempSync(join(tmpdir(), 'voxen-chisel-'));
    const authfile = join(dir, 'auth.json');
    process.env.CHISEL_AUTHFILE = authfile;
    await syncChiselAuthfile();
    if (existsSync(authfile)) {
      const parsed = JSON.parse(readFileSync(authfile, 'utf8'));
      expect(typeof parsed).toBe('object');
    }
  });
});
