import { describe, expect, test } from 'bun:test';
import { stageLabel } from './job-display';

describe('rótulos contextuais de jobs', () => {
  test('diferencia mídia, web, documento, imagem e X', () => {
    expect(stageLabel('downloading', undefined, 'DOWNLOAD_AND_TRANSCRIBE')).toBe(
      'Capturando mídia',
    );
    expect(stageLabel('downloading', undefined, 'SCRAPE_WEB')).toBe('Lendo página');
    expect(stageLabel('converting_document', undefined, 'UPLOAD_AND_ANALYZE_DOCUMENT')).toBe(
      'Convertendo para Markdown',
    );
    expect(stageLabel('preparing_upload', undefined, 'UPLOAD_AND_ANALYZE_IMAGE')).toBe(
      'Preparando imagem',
    );
    expect(stageLabel('converting_document', undefined, 'ANALYZE_X')).toBe('Lendo publicação do X');
  });

  test('nomeia armazenamento e Brain pelo significado real', () => {
    expect(stageLabel('uploading', undefined, 'SCRAPE_WEB')).toBe('Salvando conteúdo');
    expect(stageLabel('indexing', undefined, 'UPLOAD_AND_TRANSCRIBE')).toBe('Conectando ao Brain');
  });

  test('não expõe identificador cru de etapa desconhecida', () => {
    expect(stageLabel('validating_source_metadata')).toBe('Validating source metadata');
    expect(stageLabel('')).toBe('Processando conteúdo');
  });
});
