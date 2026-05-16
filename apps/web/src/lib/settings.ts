// ============================================================================
// Settings — abstração sobre Setting (cifrado em AES-256-GCM)
// ============================================================================
// API:
//   getSetting('openrouter_api_key')      → string | null (decifrado)
//   setSetting('openrouter_api_key', val) → void          (cifra + upsert)
//   isSetupComplete()                     → boolean
//
// Convenção: chaves GLOBAL não levam userId. Postgres trata múltiplos NULLs
// como distintos em UNIQUE — então usamos `findFirst` + transação em vez de
// `findUnique`/`upsert` que dependem de unique compostos com NULL.
// ============================================================================

import { db } from './db';
import { encrypt, decrypt } from './crypto';
import { getMasterKey } from './master-key';

export type GlobalSettingKey =
  | 'openrouter_api_key'
  | 'default_chat_model'
  | 'default_transcription_model';

export async function getSetting(key: GlobalSettingKey): Promise<string | null> {
  const row = await db.setting.findFirst({
    where: { scope: 'GLOBAL', userId: null, key },
    select: { valueEnc: true },
  });
  if (!row) return null;
  return decrypt(row.valueEnc, getMasterKey());
}

export async function setSetting(key: GlobalSettingKey, value: string): Promise<void> {
  const valueEnc = encrypt(value, getMasterKey());
  await db.$transaction(async (tx) => {
    const existing = await tx.setting.findFirst({
      where: { scope: 'GLOBAL', userId: null, key },
      select: { id: true },
    });
    if (existing) {
      await tx.setting.update({ where: { id: existing.id }, data: { valueEnc } });
    } else {
      await tx.setting.create({ data: { scope: 'GLOBAL', userId: null, key, valueEnc } });
    }
  });
}

export async function isSetupComplete(): Promise<boolean> {
  const row = await db.setting.findFirst({
    where: { scope: 'GLOBAL', userId: null, key: 'openrouter_api_key' },
    select: { id: true },
  });
  return row !== null;
}
