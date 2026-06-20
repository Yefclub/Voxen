import { describe, expect, it } from 'bun:test';
import app from '../src/index';

describe('PWA share target', () => {
  it('preserva link compartilhado sem sessão para enfileirar após login', async () => {
    const form = new FormData();
    form.set('text', 'Ler depois https://example.com/artigo#secao');

    const res = await app.fetch(
      new Request('http://localhost/share-target', {
        method: 'POST',
        body: form,
      }),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('/jobs?')).toBe(true);
    expect(location).toContain('shared=1');
    expect(location).toContain('url=https%3A%2F%2Fexample.com%2Fartigo');
  });

  it('sem sessão não tenta reter arquivo compartilhado após login', async () => {
    const form = new FormData();
    form.set('files', new File(['img'], 'print.png', { type: 'image/png' }));

    const res = await app.fetch(
      new Request('http://localhost/share-target', {
        method: 'POST',
        body: form,
      }),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/jobs?shared=1&share_error=auth_required_file');
  });
});
