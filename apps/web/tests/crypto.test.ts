import { describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CryptoError,
  decrypt,
  encrypt,
  loadMasterKey,
  loadMasterKeyFromEnv,
} from '../src/lib/crypto';

const KEY = randomBytes(32);

describe('encrypt/decrypt roundtrip', () => {
  it('cycles ASCII text', () => {
    const msg = 'hello voxen';
    expect(decrypt(encrypt(msg, KEY), KEY)).toBe(msg);
  });

  it('cycles utf-8 com acentos e unicode', () => {
    const msg = 'olá mundo 你好 — café com ñ';
    expect(decrypt(encrypt(msg, KEY), KEY)).toBe(msg);
  });

  it('cycles empty string', () => {
    expect(decrypt(encrypt('', KEY), KEY)).toBe('');
  });

  it('cycles large text (10KB)', () => {
    const msg = 'a'.repeat(10_000);
    expect(decrypt(encrypt(msg, KEY), KEY)).toBe(msg);
  });

  it('generates different ciphertext each call (random IV)', () => {
    const a = encrypt('same', KEY);
    const b = encrypt('same', KEY);
    expect(a).not.toBe(b);
  });

  it('output format has 3 base64 parts', () => {
    const enc = encrypt('x', KEY);
    expect(enc.split('.')).toHaveLength(3);
  });
});

describe('decrypt error handling', () => {
  it('throws CryptoError on invalid format (no dots)', () => {
    expect(() => decrypt('not_valid', KEY)).toThrow(CryptoError);
  });

  it('throws CryptoError on too few parts', () => {
    expect(() => decrypt('a.b', KEY)).toThrow(/Invalid ciphertext format/);
  });

  it('throws CryptoError on tampered ciphertext', () => {
    const enc = encrypt('hello', KEY);
    const parts = enc.split('.');
    // Flip 1 byte do ciphertext
    const ctBuf = Buffer.from(parts[1] ?? '', 'base64');
    if (ctBuf.length > 0) ctBuf[0] = ctBuf[0]! ^ 0xff;
    parts[1] = ctBuf.toString('base64');
    expect(() => decrypt(parts.join('.'), KEY)).toThrow(CryptoError);
  });

  it('throws CryptoError on wrong key', () => {
    const enc = encrypt('hello', KEY);
    expect(() => decrypt(enc, randomBytes(32))).toThrow(CryptoError);
  });

  it('throws CryptoError on invalid iv length', () => {
    const enc = encrypt('hello', KEY);
    const parts = enc.split('.');
    parts[0] = Buffer.from('short').toString('base64');
    expect(() => decrypt(parts.join('.'), KEY)).toThrow(/Invalid iv length/);
  });
});

describe('encrypt/decrypt key size validation', () => {
  it('rejects key shorter than 32 bytes', () => {
    expect(() => encrypt('hi', Buffer.from('short'))).toThrow(/32 bytes/);
  });

  it('rejects key longer than 32 bytes', () => {
    expect(() => encrypt('hi', randomBytes(48))).toThrow(/32 bytes/);
  });
});

describe('loadMasterKey', () => {
  it('loads valid 32-byte base64 key from file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voxen-key-'));
    const path = join(dir, 'master.key');
    const key = randomBytes(32);
    writeFileSync(path, key.toString('base64'));
    const loaded = loadMasterKey(path);
    expect(loaded.equals(key)).toBe(true);
  });

  it('throws CryptoError on missing file', () => {
    expect(() => loadMasterKey('/nonexistent/master.key')).toThrow(
      /FATAL: master key not accessible/,
    );
  });

  it('throws CryptoError on wrong-size key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voxen-key-'));
    const path = join(dir, 'master.key');
    writeFileSync(path, Buffer.from('only-16-bytes-xx').toString('base64'));
    expect(() => loadMasterKey(path)).toThrow(/bytes; expected 32/);
  });
});

describe('loadMasterKeyFromEnv', () => {
  it('loads valid 32-byte base64 key from env value', () => {
    const key = randomBytes(32);
    const loaded = loadMasterKeyFromEnv(key.toString('base64'));
    expect(loaded.equals(key)).toBe(true);
  });

  it('throws CryptoError on wrong-size env key', () => {
    expect(() => loadMasterKeyFromEnv(Buffer.from('short').toString('base64'))).toThrow(
      /MASTER_KEY must be base64-encoded 32 bytes/,
    );
  });
});
