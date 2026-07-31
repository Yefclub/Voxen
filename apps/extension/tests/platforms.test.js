import { describe, expect, test } from 'bun:test';
import {
  NETSCAPE_HEADER,
  PLATFORMS,
  cookieBelongsToPlatform,
  filterPlatformCookies,
  hasSessionCookie,
  platformById,
  toNetscape,
} from '../lib/platforms.js';

/** Cookie no formato que `chrome.cookies.getAll` devolve. */
function cookie(over = {}) {
  return {
    name: 'sessionid',
    value: 'abc123',
    domain: '.tiktok.com',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: true,
    session: false,
    expirationDate: 1893456000.123,
    ...over,
  };
}

describe('PLATFORMS', () => {
  test('cobre exatamente TikTok, Instagram e YouTube', () => {
    expect(PLATFORMS.map((p) => p.id)).toEqual(['tiktok', 'instagram', 'youtube']);
  });

  test('cada plataforma declara host permission restrita ao próprio domínio', () => {
    for (const p of PLATFORMS) {
      expect(p.origins.length).toBeGreaterThan(0);
      for (const origin of p.origins) {
        expect(origin).not.toBe('<all_urls>');
        expect(origin.startsWith('https://')).toBe(true);
        expect(origin).toContain(p.cookieDomain);
      }
    }
  });

  test('YouTube não captura o domínio do Google (blast radius)', () => {
    const youtube = platformById('youtube');
    expect(youtube.cookieDomain).toBe('youtube.com');
    expect(youtube.origins.join(' ')).not.toContain('google.com');
  });

  test('platformById devolve null pra id desconhecido', () => {
    expect(platformById('facebook')).toBeNull();
  });
});

describe('cookieBelongsToPlatform', () => {
  test('aceita domínio exato e subdomínio, com ou sem ponto inicial', () => {
    expect(cookieBelongsToPlatform('tiktok.com', 'tiktok.com')).toBe(true);
    expect(cookieBelongsToPlatform('.tiktok.com', 'tiktok.com')).toBe(true);
    expect(cookieBelongsToPlatform('www.tiktok.com', 'tiktok.com')).toBe(true);
    expect(cookieBelongsToPlatform('.WWW.TikTok.com', 'tiktok.com')).toBe(true);
  });

  test('rejeita domínio que só termina parecido', () => {
    expect(cookieBelongsToPlatform('eviltiktok.com', 'tiktok.com')).toBe(false);
    expect(cookieBelongsToPlatform('tiktok.com.evil.net', 'tiktok.com')).toBe(false);
    expect(cookieBelongsToPlatform('instagram.com', 'tiktok.com')).toBe(false);
  });
});

describe('filterPlatformCookies', () => {
  test('descarta cookie de domínio alheio', () => {
    const tiktok = platformById('tiktok');
    const out = filterPlatformCookies(
      [cookie(), cookie({ domain: '.google.com' }), cookie({ domain: 'www.tiktok.com' })],
      tiktok,
    );
    expect(out).toHaveLength(2);
  });
});

describe('hasSessionCookie', () => {
  test('detecta sessão do TikTok', () => {
    const tiktok = platformById('tiktok');
    expect(hasSessionCookie([cookie({ name: 'sessionid' })], tiktok)).toBe(true);
    expect(hasSessionCookie([cookie({ name: 'tt_csrf_token' })], tiktok)).toBe(false);
    expect(hasSessionCookie([], tiktok)).toBe(false);
  });

  test('cookie de sessão sem valor não conta como logado', () => {
    const tiktok = platformById('tiktok');
    expect(hasSessionCookie([cookie({ name: 'sessionid', value: '' })], tiktok)).toBe(false);
  });

  test('detecta sessão do YouTube pelos cookies do próprio youtube.com', () => {
    const youtube = platformById('youtube');
    expect(hasSessionCookie([cookie({ name: 'LOGIN_INFO' })], youtube)).toBe(true);
    expect(hasSessionCookie([cookie({ name: '__Secure-3PSID' })], youtube)).toBe(true);
    expect(hasSessionCookie([cookie({ name: 'VISITOR_INFO1_LIVE' })], youtube)).toBe(false);
  });

  test('detecta sessão do Instagram', () => {
    const instagram = platformById('instagram');
    expect(hasSessionCookie([cookie({ name: 'sessionid' })], instagram)).toBe(true);
    expect(hasSessionCookie([cookie({ name: 'csrftoken' })], instagram)).toBe(false);
  });
});

describe('toNetscape', () => {
  test('gera cabeçalho e 7 campos separados por TAB', () => {
    const out = toNetscape([cookie()]);
    const lines = out.split('\n').filter(Boolean);
    expect(lines[0]).toBe(NETSCAPE_HEADER);
    const fields = lines[1].split('\t');
    expect(fields).toHaveLength(7);
    expect(fields).toEqual([
      '.tiktok.com',
      'TRUE',
      '/',
      'TRUE',
      '1893456000',
      'sessionid',
      'abc123',
    ]);
  });

  test('termina com quebra de linha', () => {
    expect(toNetscape([cookie()]).endsWith('\n')).toBe(true);
  });

  test('hostOnly vira FALSE e domínio sem ponto inicial', () => {
    const out = toNetscape([cookie({ hostOnly: true, domain: 'www.tiktok.com' })]);
    const fields = out.split('\n')[1].split('\t');
    expect(fields[0]).toBe('www.tiktok.com');
    expect(fields[1]).toBe('FALSE');
  });

  test('cookie de domínio sem ponto inicial ganha o ponto quando não é hostOnly', () => {
    const out = toNetscape([cookie({ hostOnly: false, domain: 'tiktok.com' })]);
    expect(out.split('\n')[1].split('\t')[0]).toBe('.tiktok.com');
  });

  test('secure=false vira FALSE', () => {
    const out = toNetscape([cookie({ secure: false })]);
    expect(out.split('\n')[1].split('\t')[3]).toBe('FALSE');
  });

  test('cookie de sessão (sem expirationDate) expira em 0', () => {
    const out = toNetscape([cookie({ session: true, expirationDate: undefined })]);
    expect(out.split('\n')[1].split('\t')[4]).toBe('0');
  });

  test('expiração é inteiro em segundos, nunca negativa nem com fração', () => {
    const out = toNetscape([cookie({ expirationDate: -5 })]);
    expect(out.split('\n')[1].split('\t')[4]).toBe('0');
    const out2 = toNetscape([cookie({ expirationDate: 1700000000.9 })]);
    expect(out2.split('\n')[1].split('\t')[4]).toBe('1700000000');
  });

  test('path vazio vira /', () => {
    const out = toNetscape([cookie({ path: '' })]);
    expect(out.split('\n')[1].split('\t')[2]).toBe('/');
  });

  test('não emite prefixo #HttpOnly_ (parsers da stdlib descartariam a linha)', () => {
    const out = toNetscape([cookie({ httpOnly: true })]);
    expect(out).not.toContain('#HttpOnly_');
  });

  test('descarta cookie com TAB ou quebra de linha em nome/valor', () => {
    const out = toNetscape([
      cookie({ name: 'bad\tname' }),
      cookie({ value: 'bad\nvalue' }),
      cookie({ name: 'ok', value: 'fine' }),
    ]);
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1].split('\t')[5]).toBe('ok');
  });

  test('descarta cookie sem nome ou sem domínio', () => {
    const out = toNetscape([cookie({ name: '' }), cookie({ domain: '' }), cookie({ name: 'ok' })]);
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1].split('\t')[5]).toBe('ok');
  });

  test('lista vazia devolve string vazia (nada a enviar)', () => {
    expect(toNetscape([])).toBe('');
    expect(toNetscape([cookie({ name: '' })])).toBe('');
  });

  test('preserva múltiplos cookies na ordem recebida', () => {
    const out = toNetscape([cookie({ name: 'a' }), cookie({ name: 'b' })]);
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[1].split('\t')[5]).toBe('a');
    expect(lines[2].split('\t')[5]).toBe('b');
  });
});
