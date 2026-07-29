import { describe, expect, test } from 'bun:test';
import { releaseTypeI18nKey } from './release-type';

describe('tipo de release', () => {
  test('mapeia tipos conhecidos e preserva extensibilidade para tipos desconhecidos', () => {
    expect(releaseTypeI18nKey('feat')).toBe('novidades.type.feat');
    expect(releaseTypeI18nKey('security')).toBe('novidades.type.security');
    expect(releaseTypeI18nKey('experimental')).toBeNull();
  });
});
