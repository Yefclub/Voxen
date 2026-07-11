// ============================================================================
// Voxen — Master Key Crypto
// ============================================================================
// AES-256-GCM autenticado para cifrar secrets que ficam em DB
// (Settings.valueEnc — ver schema.prisma + spec 000).
//
// Formato do ciphertext (string base64 com 3 partes separadas por ponto):
//
//   <iv_base64>.<ciphertext_base64>.<tag_base64>
//
// - iv: 12 bytes aleatórios por mensagem (recomendado pelo NIST p/ GCM)
// - ciphertext: AES-256-GCM(plaintext, key, iv) sem o tag
// - tag: 16 bytes de authentication tag
//
// O mesmo formato é implementado em Python em apps/worker,
// pra que as 3 aplicações decifrem/cifrem os mesmos blobs no DB.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12; // NIST SP 800-38D recommended
const TAG_LEN = 16;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Cifra `plaintext` com a `key` usando AES-256-GCM. Retorna string base64
 * no formato `iv.ciphertext.tag`.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LEN) {
    throw new CryptoError(`Master key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((b) => b.toString('base64')).join('.');
}

/**
 * Decifra string `encrypted` (formato `iv.ciphertext.tag` em base64) com a `key`.
 * Joga `CryptoError` em qualquer falha (formato inválido, tampering, chave errada).
 */
export function decrypt(encrypted: string, key: Buffer): string {
  if (key.length !== KEY_LEN) {
    throw new CryptoError(`Master key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  const parts = encrypted.split('.');
  if (parts.length !== 3) {
    throw new CryptoError(`Invalid ciphertext format (expected 3 parts, got ${parts.length})`);
  }
  const [ivB64, ctB64, tagB64] = parts;
  let iv: Buffer;
  let ciphertext: Buffer;
  let tag: Buffer;
  try {
    iv = Buffer.from(ivB64 ?? '', 'base64');
    ciphertext = Buffer.from(ctB64 ?? '', 'base64');
    tag = Buffer.from(tagB64 ?? '', 'base64');
  } catch {
    throw new CryptoError('Invalid base64 in ciphertext parts');
  }
  if (iv.length !== IV_LEN) {
    throw new CryptoError(`Invalid iv length ${iv.length}, expected ${IV_LEN}`);
  }
  if (tag.length !== TAG_LEN) {
    throw new CryptoError(`Invalid tag length ${tag.length}, expected ${TAG_LEN}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new CryptoError(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Carrega master key legada de `path`. Arquivo é base64 do raw key (32 bytes).
 */
export function loadMasterKey(path: string): Buffer {
  let content: string;
  try {
    content = readFileSync(path, 'utf8').trim();
  } catch (err) {
    throw new CryptoError(
      `FATAL: master key not accessible at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const key = Buffer.from(content, 'base64');
  if (key.length !== KEY_LEN) {
    throw new CryptoError(`Master key at ${path} is ${key.length} bytes; expected ${KEY_LEN}`);
  }
  return key;
}

/**
 * Carrega master key direto de uma env var. Valor esperado: base64 do raw key
 * de 32 bytes (`openssl rand -base64 32`).
 */
export function loadMasterKeyFromEnv(value: string, name = 'MASTER_KEY'): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== KEY_LEN) {
    throw new CryptoError(`FATAL: ${name} must be base64-encoded ${KEY_LEN} bytes`);
  }
  return key;
}
