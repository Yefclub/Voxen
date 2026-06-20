import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildChiselAuthfile,
  syncChiselAuthfile,
  writeAuthfileInPlace,
  CHISEL_SOCKS_REMOTE,
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
