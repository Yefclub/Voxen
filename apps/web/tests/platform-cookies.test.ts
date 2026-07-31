// ============================================================================
// Unit tests — lib/platform-cookies (spec 121)
// ============================================================================
// Lógica pura de validação/merge do arquivo Netscape guardado em
// `yt_dlp_cookies`. Nenhum destes testes toca DB nem rede.
// ============================================================================

import { describe, expect, it } from 'bun:test';
import {
  COOKIE_PLATFORMS,
  COOKIE_STALE_AFTER_MS,
  hasPlatformCookie,
  isCaptureStale,
  isCookiePlatform,
  mergePlatformCookies,
  NETSCAPE_HEADER,
  parseCaptureMeta,
  parseCapturedCookies,
  removePlatformCookies,
  serializeCaptureMeta,
} from '../src/lib/platform-cookies';

function line(domain: string, name = 'sessionid', value = 'v', expires = '1893456000'): string {
  return [domain, 'TRUE', '/', 'TRUE', expires, name, value].join('\t');
}

function doc(...lines: string[]): string {
  return `${NETSCAPE_HEADER}\n${lines.join('\n')}\n`;
}

function dataLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() && !l.startsWith('# '));
}

describe('isCookiePlatform', () => {
  it('aceita as três plataformas suportadas e nada mais', () => {
    expect(COOKIE_PLATFORMS).toEqual(['tiktok', 'instagram', 'youtube']);
    for (const p of COOKIE_PLATFORMS) expect(isCookiePlatform(p)).toBe(true);
    expect(isCookiePlatform('facebook')).toBe(false);
    expect(isCookiePlatform('')).toBe(false);
    expect(isCookiePlatform(null)).toBe(false);
    expect(isCookiePlatform(42)).toBe(false);
  });
});

describe('parseCapturedCookies', () => {
  it('aceita um documento Netscape válido e devolve só as linhas de dados', () => {
    const res = parseCapturedCookies('tiktok', doc(line('.tiktok.com'), line('www.tiktok.com')));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines).toHaveLength(2);
      expect(res.lines[0]).toBe(line('.tiktok.com'));
    }
  });

  it('rejeita conteúdo vazio', () => {
    expect(parseCapturedCookies('tiktok', '').ok).toBe(false);
    expect(parseCapturedCookies('tiktok', `${NETSCAPE_HEADER}\n`).ok).toBe(false);
  });

  it('rejeita linha com número de campos diferente de 7', () => {
    const res = parseCapturedCookies('tiktok', doc('.tiktok.com\tTRUE\t/\tTRUE\t0\tname'));
    expect(res.ok).toBe(false);
  });

  it('rejeita expiração não numérica (o yt-dlp derruba o arquivo inteiro)', () => {
    const res = parseCapturedCookies('tiktok', doc(line('.tiktok.com', 'a', 'b', '17e9')));
    expect(res.ok).toBe(false);
  });

  it('rejeita flag fora de TRUE/FALSE', () => {
    const bad = ['.tiktok.com', 'YES', '/', 'TRUE', '0', 'n', 'v'].join('\t');
    expect(parseCapturedCookies('tiktok', doc(bad)).ok).toBe(false);
  });

  it('rejeita cookie de domínio que não pertence à plataforma declarada', () => {
    const res = parseCapturedCookies('tiktok', doc(line('.tiktok.com'), line('.google.com')));
    expect(res.ok).toBe(false);
  });

  it('rejeita domínio que apenas termina parecido com o da plataforma', () => {
    expect(parseCapturedCookies('tiktok', doc(line('eviltiktok.com'))).ok).toBe(false);
  });

  it('rejeita cookie sem nome', () => {
    expect(parseCapturedCookies('tiktok', doc(line('.tiktok.com', ''))).ok).toBe(false);
  });

  it('aceita subdomínio da plataforma', () => {
    expect(parseCapturedCookies('youtube', doc(line('.www.youtube.com'))).ok).toBe(true);
  });

  it('nunca ecoa o conteúdo da linha na mensagem de erro', () => {
    const secret = 'SUPER-SECRET-COOKIE-VALUE';
    const res = parseCapturedCookies(
      'tiktok',
      doc(['.tiktok.com', 'TRUE', '/', 'TRUE', 'nao-e-numero', 'sessionid', secret].join('\t')),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toContain(secret);
      expect(res.error).not.toContain('sessionid');
      expect(res.error).toMatch(/linha 1/i);
    }
  });

  it('rejeita payload absurdamente grande', () => {
    const huge = doc(...Array.from({ length: 5000 }, () => line('.tiktok.com')));
    expect(parseCapturedCookies('tiktok', huge).ok).toBe(false);
  });

  it('normaliza o prefixo #HttpOnly_ para linha de dados comum', () => {
    const res = parseCapturedCookies('tiktok', doc(`#HttpOnly_${line('.tiktok.com')}`));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0]).toBe(line('.tiktok.com'));
  });
});

describe('mergePlatformCookies', () => {
  it('cria o arquivo do zero com cabeçalho único', () => {
    const out = mergePlatformCookies(null, 'tiktok', [line('.tiktok.com')]);
    expect(out.startsWith(`${NETSCAPE_HEADER}\n`)).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
    expect(dataLines(out)).toHaveLength(1);
  });

  it('substitui só as linhas da plataforma gravada', () => {
    const existing = doc(line('.tiktok.com', 'antigo'), line('.instagram.com', 'insta'));
    const out = mergePlatformCookies(existing, 'tiktok', [line('.tiktok.com', 'novo')]);
    const lines = dataLines(out);
    expect(lines).toHaveLength(2);
    expect(out).toContain('insta');
    expect(out).toContain('novo');
    expect(out).not.toContain('antigo');
  });

  it('preserva verbatim linhas de domínios fora das plataformas suportadas', () => {
    const existing = doc(line('.exemplo.com', 'manual'), line('.tiktok.com', 'antigo'));
    const out = mergePlatformCookies(existing, 'tiktok', [line('.tiktok.com', 'novo')]);
    expect(out).toContain(line('.exemplo.com', 'manual'));
  });

  it('não duplica cabeçalho quando o arquivo existente já tinha um', () => {
    const existing = doc(line('.instagram.com'));
    const out = mergePlatformCookies(existing, 'tiktok', [line('.tiktok.com')]);
    expect(out.split('\n').filter((l) => l === NETSCAPE_HEADER)).toHaveLength(1);
  });

  it('preserva a linha #HttpOnly_ de outra plataforma sem reescrevê-la', () => {
    const existing = doc(`#HttpOnly_${line('.instagram.com', 'insta')}`);
    const out = mergePlatformCookies(existing, 'tiktok', [line('.tiktok.com')]);
    expect(out).toContain(`#HttpOnly_${line('.instagram.com', 'insta')}`);
  });
});

describe('removePlatformCookies / hasPlatformCookie', () => {
  it('remove só a plataforma pedida', () => {
    const existing = doc(line('.tiktok.com'), line('.instagram.com'));
    const out = removePlatformCookies(existing, 'tiktok');
    expect(hasPlatformCookie(out, 'tiktok')).toBe(false);
    expect(hasPlatformCookie(out, 'instagram')).toBe(true);
  });

  it('devolve string vazia quando não sobra nenhuma linha', () => {
    expect(removePlatformCookies(doc(line('.tiktok.com')), 'tiktok')).toBe('');
  });

  it('hasPlatformCookie enxerga cookie colado manualmente antes da feature', () => {
    expect(hasPlatformCookie(doc(`#HttpOnly_${line('.youtube.com')}`), 'youtube')).toBe(true);
    expect(hasPlatformCookie(null, 'youtube')).toBe(false);
    expect(hasPlatformCookie('', 'youtube')).toBe(false);
  });

  it('hasPlatformCookie não confunde domínio parecido', () => {
    expect(hasPlatformCookie(doc(line('eviltiktok.com')), 'tiktok')).toBe(false);
  });
});

describe('isCaptureStale', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');

  it('é falso logo após a captura', () => {
    expect(isCaptureStale(new Date(now.getTime() - 1000).toISOString(), now)).toBe(false);
  });

  it('é falso no limite exato de 7 dias e verdadeiro depois', () => {
    const exact = new Date(now.getTime() - COOKIE_STALE_AFTER_MS).toISOString();
    expect(isCaptureStale(exact, now)).toBe(false);
    const past = new Date(now.getTime() - COOKIE_STALE_AFTER_MS - 1).toISOString();
    expect(isCaptureStale(past, now)).toBe(true);
  });

  it('sem data conhecida não afirma expiração (evita alarme falso)', () => {
    expect(isCaptureStale(null, now)).toBe(false);
    expect(isCaptureStale('nao-e-data', now)).toBe(false);
  });
});

describe('parseCaptureMeta / serializeCaptureMeta', () => {
  it('faz round-trip', () => {
    const meta = { tiktok: { capturedAt: '2026-07-30T10:00:00.000Z' } };
    expect(parseCaptureMeta(serializeCaptureMeta(meta))).toEqual(meta);
  });

  it('tolera JSON inválido, nulo e chaves desconhecidas', () => {
    expect(parseCaptureMeta(null)).toEqual({});
    expect(parseCaptureMeta('{')).toEqual({});
    expect(parseCaptureMeta('[]')).toEqual({});
    expect(parseCaptureMeta('{"facebook":{"capturedAt":"2026-01-01T00:00:00.000Z"}}')).toEqual({});
    expect(parseCaptureMeta('{"tiktok":{"capturedAt":123}}')).toEqual({});
  });
});
