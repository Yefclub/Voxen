// ============================================================================
// Range/streaming da mídia original de uploads (spec 036)
// ============================================================================
// O player de vídeo/áudio (e o Safari/iOS obrigatoriamente) precisa de 206 +
// Accept-Ranges para seek. `buildOriginalResponseInit` decide status + headers.
// ============================================================================

import { describe, expect, it } from 'bun:test';
import { buildOriginalResponseInit } from '../src/routes/transcripts';

describe('buildOriginalResponseInit', () => {
  it('200 + accept-ranges + content-length quando não há Range', () => {
    const init = buildOriginalResponseInit({
      fallbackMime: 'video/mp4',
      filename: 'video.mp4',
      s3ContentLength: 1000,
    });
    expect(init.status).toBe(200);
    expect(init.headers['accept-ranges']).toBe('bytes');
    expect(init.headers['content-length']).toBe('1000');
    expect(init.headers['content-type']).toBe('video/mp4');
    expect(init.headers['content-range']).toBeUndefined();
    expect(init.headers['content-disposition']?.startsWith('inline')).toBe(true);
    expect(init.headers['x-content-type-options']).toBe('nosniff');
  });

  it('206 + content-range quando o S3 satisfaz o Range', () => {
    const init = buildOriginalResponseInit({
      rangeHeader: 'bytes=0-499',
      s3ContentRange: 'bytes 0-499/1000',
      s3ContentLength: 500,
      fallbackMime: 'video/mp4',
      filename: 'video.mp4',
    });
    expect(init.status).toBe(206);
    expect(init.headers['content-range']).toBe('bytes 0-499/1000');
    expect(init.headers['content-length']).toBe('500');
    expect(init.headers['accept-ranges']).toBe('bytes');
  });

  it('cai para 200 se veio Range mas o S3 não devolveu content-range', () => {
    const init = buildOriginalResponseInit({
      rangeHeader: 'bytes=0-',
      fallbackMime: null,
      filename: 'arquivo.bin',
    });
    expect(init.status).toBe(200);
    expect(init.headers['content-type']).toBe('application/octet-stream');
  });

  it('prioriza o MIME persistido sobre o do S3', () => {
    const init = buildOriginalResponseInit({
      fallbackMime: 'audio/mpeg',
      s3ContentType: 'application/octet-stream',
      filename: 'audio.mp3',
    });
    expect(init.headers['content-type']).toBe('audio/mpeg');
  });
});

// Segurança: upload do usuário é não-confiável. Só mídia segura vai inline; o
// resto (html/svg/pdf) vira attachment, e nosniff sempre presente. Evita XSS
// armazenado ao servir um .html malicioso same-origin.
describe('buildOriginalResponseInit — disposição segura', () => {
  const cases: [string, 'inline' | 'attachment'][] = [
    ['video/mp4', 'inline'],
    ['audio/mpeg', 'inline'],
    ['image/png', 'inline'],
    ['image/jpeg', 'inline'],
    ['image/webp', 'inline'],
    ['image/gif', 'inline'],
    ['image/svg+xml', 'attachment'],
    ['text/html', 'attachment'],
    ['application/xhtml+xml', 'attachment'],
    ['application/pdf', 'attachment'],
    ['application/octet-stream', 'attachment'],
    // Vetores de bypass: parâmetro e case não devem furar a allowlist.
    ['text/html; charset=utf-8', 'attachment'],
    ['TEXT/HTML', 'attachment'],
    ['VIDEO/MP4', 'inline'],
  ];
  for (const [mime, disposition] of cases) {
    it(`${mime} -> ${disposition}`, () => {
      const init = buildOriginalResponseInit({ fallbackMime: mime, filename: 'f' });
      expect(init.headers['content-disposition']?.startsWith(disposition)).toBe(true);
      expect(init.headers['x-content-type-options']).toBe('nosniff');
    });
  }
});
