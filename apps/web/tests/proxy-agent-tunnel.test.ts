import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
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
  probeAgentConnected,
  detectConflictInLog,
  readConflictFlag,
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
      'voxen:abc123': ['^R:127\\.0\\.0\\.1:1080(:socks)?$'],
    });
  });

  it('the regex matches the canonical remote with and without :socks and nothing broader', () => {
    const regex = new RegExp(buildChiselAuthfile('t')['voxen:t']![0]!);
    expect(regex.test(CHISEL_SOCKS_REMOTE)).toBe(true);
    expect(regex.test('R:127.0.0.1:1080:socks')).toBe(true);
    // O chisel valida o remote SEM o sufixo de tipo — precisa casar também.
    expect(regex.test('R:127.0.0.1:1080')).toBe(true);
    // Não pode casar bind aberto (0.0.0.0) nem outras portas.
    expect(regex.test('R:0.0.0.0:1080:socks')).toBe(false);
    expect(regex.test('R:0.0.0.0:1080')).toBe(false);
    expect(regex.test('R:127.0.0.1:1080:socks:extra')).toBe(false);
    expect(regex.test('R:127x0x0x1:1080:socks')).toBe(false);
    expect(regex.test('R:127.0.0.1:9999')).toBe(false);
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

  it('keeps https from an https APP_BASE_URL with the tunnel path (chisel upgrades itself)', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    expect(deriveTunnelUrl()).toBe('https://voxen.exemplo.com/_tunnel');
  });

  it('keeps http from an http APP_BASE_URL (dev) with the tunnel path', () => {
    clear();
    process.env.APP_BASE_URL = 'http://localhost:3000';
    expect(deriveTunnelUrl()).toBe('http://localhost:3000/_tunnel');
  });

  it('preserves a non-default port from APP_BASE_URL', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com:8443';
    expect(deriveTunnelUrl()).toBe('https://voxen.exemplo.com:8443/_tunnel');
  });

  it('uses a custom PROXY_TUNNEL_PATH in the derived URL', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    process.env.PROXY_TUNNEL_PATH = '/wormhole';
    expect(deriveTunnelUrl()).toBe('https://voxen.exemplo.com/wormhole');
  });

  it('does NOT prefix the host with tunnel. (legacy behavior removed)', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    expect(deriveTunnelUrl()).not.toContain('tunnel.voxen');
  });

  it('PROXY_TUNNEL_URL takes precedence over APP_BASE_URL', () => {
    clear();
    process.env.APP_BASE_URL = 'https://voxen.exemplo.com';
    process.env.PROXY_TUNNEL_URL = 'https://outro-host.net:9000/control';
    expect(deriveTunnelUrl()).toBe('https://outro-host.net:9000/control');
  });

  it('normalizes an explicit wss:// PROXY_TUNNEL_URL to https:// (chisel wants http(s))', () => {
    clear();
    process.env.PROXY_TUNNEL_URL = 'wss://outro-host.net:9000/control';
    expect(deriveTunnelUrl()).toBe('https://outro-host.net:9000/control');
  });

  it('normalizes an explicit ws:// PROXY_TUNNEL_URL to http://', () => {
    clear();
    process.env.PROXY_TUNNEL_URL = 'ws://localhost:9000/control';
    expect(deriveTunnelUrl()).toBe('http://localhost:9000/control');
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

describe('probeAgentConnected (TCP probe ao SOCKS reverso)', () => {
  const original = process.env.CHISEL_SOCKS_PORT;
  afterEach(() => {
    if (original === undefined) delete process.env.CHISEL_SOCKS_PORT;
    else process.env.CHISEL_SOCKS_PORT = original;
  });

  function listenOnEphemeral(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({ server, port });
      });
    });
  }

  it('resolves true when something is listening on the SOCKS port (agente conectado)', async () => {
    const { server, port } = await listenOnEphemeral();
    process.env.CHISEL_SOCKS_PORT = String(port);
    try {
      await expect(probeAgentConnected(1000)).resolves.toBe(true);
    } finally {
      server.close();
    }
  });

  it('resolves false when the SOCKS port is closed (agente desconectado)', async () => {
    // Abre e fecha pra garantir uma porta livre que recusa a conexão.
    const { server, port } = await listenOnEphemeral();
    await new Promise<void>((r) => server.close(() => r()));
    process.env.CHISEL_SOCKS_PORT = String(port);
    await expect(probeAgentConnected(500)).resolves.toBe(false);
  });

  it('never throws — resolves a boolean even with a bogus port', async () => {
    process.env.CHISEL_SOCKS_PORT = 'not-a-port';
    const result = await probeAgentConnected(300);
    expect(typeof result).toBe('boolean');
  });
});

describe('detectConflictInLog (parse de "address already in use")', () => {
  it('returns false for empty content', () => {
    expect(detectConflictInLog('')).toBe(false);
  });

  it('returns false for normal chisel logs without conflict', () => {
    const log = [
      '2026/06/21 server: Reverse tunnelling enabled',
      '2026/06/21 server: Listening on http://0.0.0.0:8088',
      '2026/06/21 server: session#1: tun: proxy#R:127.0.0.1:1080=>socks: Listening',
    ].join('\n');
    expect(detectConflictInLog(log)).toBe(false);
  });

  it('detects "address already in use" (2nd agent tried to bind)', () => {
    const log = [
      '2026/06/21 server: session#2: tun: proxy#R:127.0.0.1:1080=>socks:',
      '2026/06/21 server: listen tcp 127.0.0.1:1080: bind: address already in use',
    ].join('\n');
    expect(detectConflictInLog(log)).toBe(true);
  });

  it('is case-insensitive on the marker', () => {
    expect(detectConflictInLog('ERROR: Address Already In Use')).toBe(true);
  });

  it('ignores an old conflict outside the tail window', () => {
    const lines = ['bind: address already in use'];
    for (let i = 0; i < 300; i++) lines.push(`2026/06/21 server: heartbeat ${i}`);
    expect(detectConflictInLog(lines.join('\n'), 200)).toBe(false);
  });
});

describe('readConflictFlag (best-effort I/O)', () => {
  const original = process.env.CHISEL_LOGFILE;
  afterEach(() => {
    if (original === undefined) delete process.env.CHISEL_LOGFILE;
    else process.env.CHISEL_LOGFILE = original;
  });

  it('returns false when the log file does not exist (dev / sem chisel)', async () => {
    process.env.CHISEL_LOGFILE = '/proc/voxen-nonexistent/chisel.log';
    await expect(readConflictFlag()).resolves.toBe(false);
  });

  it('returns true when the log contains a recent conflict marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voxen-chisel-log-'));
    const logfile = join(dir, 'chisel.log');
    writeFileSync(logfile, 'server: listen tcp 127.0.0.1:1080: bind: address already in use\n');
    process.env.CHISEL_LOGFILE = logfile;
    await expect(readConflictFlag()).resolves.toBe(true);
  });

  it('returns false for a clean log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voxen-chisel-log-'));
    const logfile = join(dir, 'chisel.log');
    writeFileSync(logfile, 'server: Listening on http://0.0.0.0:8088\n');
    process.env.CHISEL_LOGFILE = logfile;
    await expect(readConflictFlag()).resolves.toBe(false);
  });

  it('ignores an old conflict marker beyond the tail window (lê só a cauda)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voxen-chisel-log-'));
    const logfile = join(dir, 'chisel.log');
    // Conflito antigo no início, seguido de >64KB de linhas limpas: o marcador
    // fica fora da janela de cauda lida, então não deve disparar conflito.
    const oldConflict = 'server: bind: address already in use\n';
    const filler = 'server: keepalive ping\n'.repeat(5000); // ~110KB > 64KB
    writeFileSync(logfile, oldConflict + filler);
    process.env.CHISEL_LOGFILE = logfile;
    await expect(readConflictFlag()).resolves.toBe(false);
  });
});
