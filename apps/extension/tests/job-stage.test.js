import { describe, expect, test } from 'bun:test';
import { stageLabel } from '../lib/job-stage.js';

describe('stageLabel', () => {
  test('rótulo base quando sem jobType', () => {
    expect(stageLabel('downloading')).toBe('Baixando vídeo');
    expect(stageLabel('transcribing')).toBe('Transcrevendo');
    expect(stageLabel('summarizing')).toBe('Gerando resumo');
    expect(stageLabel('queued')).toBe('Na fila');
  });

  test('rótulo contextual por tipo de job', () => {
    expect(stageLabel('downloading', 'SCRAPE_WEB')).toBe('Lendo página');
    expect(stageLabel('downloading', 'DOWNLOAD_AND_TRANSCRIBE')).toBe('Capturando mídia');
    expect(stageLabel('choosing_method', 'DOWNLOAD_AND_TRANSCRIBE')).toBe('Preparando transcrição');
    expect(stageLabel('indexing', 'SCRAPE_WEB')).toBe('Conectando ao Brain');
    expect(stageLabel('uploading', 'UPLOAD_AND_TRANSCRIBE')).toBe('Salvando conteúdo');
  });

  test('etapa desconhecida cai no humanize', () => {
    expect(stageLabel('some_new_stage')).toBe('Some new stage');
  });

  test('vazio retorna placeholder genérico', () => {
    expect(stageLabel('')).toBe('Processando…');
  });
});
