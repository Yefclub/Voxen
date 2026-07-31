import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = join(import.meta.dir, '../src/client');

function read(path: string): string {
  return readFileSync(join(CLIENT_ROOT, path), 'utf8');
}

describe('campo de colar link (ação principal da tela de conteúdo)', () => {
  test('placeholder é curto e direto nos dois idiomas', () => {
    const i18n = read('lib/i18n.tsx');
    expect(i18n).toContain("'home.urlPlaceholder': 'Cole o link aqui'");
    expect(i18n).toContain("'home.urlPlaceholder': 'Paste the link here'");
    // O placeholder longo com exemplos de URL não volta.
    expect(i18n).not.toContain('https://youtu.be/... ·');
  });

  test('campo tem destaque visual com tokens do design system', () => {
    const card = read('components/ingest/content-ingest-card.tsx');
    expect(card).toContain('data-ingest-url-field');
    expect(card).toContain('bg-[var(--color-app-bg-elevated)]');
    expect(card).toContain('border-[var(--color-app-border-strong)]');
    expect(card).toContain('focus:border-[var(--color-accent-primary)]');
    expect(card).toContain('focus:ring-[var(--color-accent-primary-soft)]');
  });
});

describe('reprocessar item da fila', () => {
  const queue = read('components/ingest/jobs-queue-section.tsx');

  test('usa o endpoint de retry existente em vez de criar rota nova', () => {
    expect(queue).toContain('/retry');
    expect(queue).toContain('canRetryJob(job.status)');
    expect(queue).toContain('resolveJobRetryFeedback');
  });

  test('ação só aparece em item reprocessável e não envia userId do cliente', () => {
    expect(queue).toContain('{canReprocess && (');
    expect(queue).toContain("t('jobs.reprocess')");
    expect(queue).not.toContain('userId');
  });

  test('recusa vira aviso sem mutar o item', () => {
    expect(queue).toContain('toast.error(feedback.message)');
    expect(queue).toContain("t('jobs.reprocessQueued')");
  });

  test('botão não fica aninhado dentro do link da linha', () => {
    // O link vira overlay (`absolute inset-0`); botão dentro de <a> é HTML
    // inválido e quebra teclado/leitor de tela.
    expect(queue).toContain('className="absolute inset-0 rounded-lg');
    expect(queue).not.toContain('</Link>');
  });

  test('rótulos de reprocessamento existem em PT e EN', () => {
    const i18n = read('lib/i18n.tsx');
    for (const key of [
      'jobs.reprocess',
      'jobs.reprocessing',
      'jobs.reprocessQueued',
      'jobs.reprocessError',
    ]) {
      expect(i18n.match(new RegExp(`'${key}':`, 'gu'))?.length).toBe(2);
    }
  });
});

describe('linha do tempo do job', () => {
  const detail = read('pages/jobs-detalhe.tsx');

  test('marcadores e trilho compartilham a mesma origem horizontal', () => {
    expect(detail).toContain('before:left-0 before:w-px');
    expect(detail).toContain('absolute left-0 top-1.5 h-2 w-2 -translate-x-[3.5px]');
    // O deslocamento mágico antigo (desalinhado com a linha) não volta.
    expect(detail).not.toContain('-left-[1.46rem]');
    expect(detail).not.toContain('border-l border-[var(--color-app-border)] pl-5');
  });
});

describe('renderização do conteúdo da transcrição', () => {
  test('detalhe escolhe o modo pelo helper testado, não por lista de origens', () => {
    const page = read('pages/transcricoes-detalhe.tsx');
    expect(page).toContain('transcriptRenderMode');
    expect(page).toContain("renderMode === 'markdown'");
    expect(page).not.toContain("t.source === 'WEB' || isVisualTranscript || isDocumentTranscript");
  });
});
