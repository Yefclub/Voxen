import { describe, expect, test } from 'bun:test';
import { createLatestOnlyRevalidator, createSharedLoader } from '../src/client/lib/use-notes';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createLatestOnlyRevalidator', () => {
  test('descarta a resposta antiga quando duas revalidações terminam fora de ordem', async () => {
    const first = deferred<string[] | null>();
    const second = deferred<string[] | null>();
    const pending = [first, second];
    const applied: string[][] = [];
    const revalidate = createLatestOnlyRevalidator(
      () => pending.shift()!.promise,
      (notes) => applied.push(notes),
    );

    const older = revalidate();
    const newer = revalidate();
    second.resolve(['nota-nova']);
    expect(await newer).toBe(true);
    first.resolve(['nota-antiga']);
    expect(await older).toBe(false);

    expect(applied).toEqual([['nota-nova']]);
  });

  test('preserva o estado aplicado quando a revalidação falha', async () => {
    const applied: string[][] = [['nota-em-cache']];
    const revalidate = createLatestOnlyRevalidator(
      async () => null,
      (notes: string[]) => applied.push(notes),
    );

    expect(await revalidate()).toBe(true);
    expect(applied).toEqual([['nota-em-cache']]);
  });

  test('aplica uma invalidação de acesso mesmo se a resposta chegar atrasada', async () => {
    const first = deferred<{ notes: string[]; accessRevoked: boolean } | null>();
    const second = deferred<{ notes: string[]; accessRevoked: boolean } | null>();
    const pending = [first, second];
    const applied: string[][] = [['nota-em-cache']];
    const revalidate = createLatestOnlyRevalidator(
      () => pending.shift()!.promise,
      (result) => applied.push(result.notes),
      (result) => result.accessRevoked,
    );

    const older = revalidate();
    const newer = revalidate();
    second.resolve(null);
    expect(await newer).toBe(true);
    first.resolve({ notes: [], accessRevoked: true });
    expect(await older).toBe(false);

    expect(applied).toEqual([['nota-em-cache'], []]);
  });
});

describe('createSharedLoader', () => {
  test('compartilha a consulta inicial em voo entre consumidores', async () => {
    let calls = 0;
    let resolveRequest: ((value: string) => void) | undefined;
    const load = createSharedLoader(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolveRequest = resolve;
        }),
    );

    const first = load();
    const second = load();

    expect(calls).toBe(1);
    expect(first).toBe(second);
    resolveRequest?.('ok');
    await expect(first).resolves.toBe('ok');
  });
});
