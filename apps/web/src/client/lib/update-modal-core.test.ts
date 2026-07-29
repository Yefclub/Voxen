import { describe, expect, test } from 'bun:test';
import {
  resolveReleaseCopy,
  resolveReleaseView,
  resolveUpdateModalEffect,
} from './update-modal-core';

describe('intenções do modal de atualização', () => {
  test('aplicar é a única intenção que executa a atualização', () => {
    const idle = { applying: false, streaming: false };
    expect(resolveUpdateModalEffect('apply', idle)).toBe('apply');
    expect(resolveUpdateModalEffect('defer', idle)).toBe('snooze');
    expect(resolveUpdateModalEffect('dismiss', idle)).toBe('snooze');
    expect(resolveUpdateModalEffect('open-changelog', idle)).toBe('snooze');
  });

  test('streaming bloqueia aplicar sem bloquear adiar ou abrir novidades', () => {
    const streaming = { applying: false, streaming: true };
    expect(resolveUpdateModalEffect('apply', streaming)).toBe('none');
    expect(resolveUpdateModalEffect('defer', streaming)).toBe('snooze');
    expect(resolveUpdateModalEffect('open-changelog', streaming)).toBe('snooze');
  });

  test('nenhuma segunda ação disputa com uma atualização já em curso', () => {
    const applying = { applying: true, streaming: false };
    for (const intent of ['apply', 'defer', 'dismiss', 'open-changelog'] as const) {
      expect(resolveUpdateModalEffect(intent, applying), intent).toBe('none');
    }
  });
});

describe('estados das notas da versão', () => {
  test('diferencia carregamento, falha, release e resposta vazia', () => {
    expect(resolveReleaseView('loading', false)).toBe('loading');
    expect(resolveReleaseView('error', false)).toBe('error');
    expect(resolveReleaseView('ready', true)).toBe('release');
    expect(resolveReleaseView('ready', false)).toBe('empty');
  });

  test('preserva título, resumo e corpo distintos sem duplicar conteúdo', () => {
    expect(
      resolveReleaseCopy({
        title: 'Título',
        summary: 'Resumo',
        body: 'Corpo detalhado',
      }),
    ).toEqual({
      heading: 'Título',
      details: ['Resumo', 'Corpo detalhado'],
    });
    expect(resolveReleaseCopy({ summary: 'Resumo', body: 'Resumo' })).toEqual({
      heading: 'Resumo',
      details: [],
    });
  });
});
