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

  test('nomeia toda a trilha de pesquisa seletiva', () => {
    expect(stageLabel('research_planning')).toBe('Avaliando lacunas do conteúdo');
    expect(stageLabel('research_source_lookup')).toBe('Consultando a fonte original');
    expect(stageLabel('research_searching')).toBe('Pesquisando contexto adicional');
    expect(stageLabel('research_synthesizing')).toBe('Organizando evidências encontradas');
    expect(stageLabel('research_not_needed')).toBe('Pesquisa adicional não necessária');
    expect(stageLabel('research_ready')).toBe('Contexto adicional pronto para revisão');
    expect(stageLabel('research_retry')).toBe('Pesquisa aguardando nova tentativa');
    expect(stageLabel('research_failed')).toBe('Pesquisa adicional falhou');
    expect(stageLabel('research_cancelled')).toBe('Pesquisa adicional cancelada');
  });
});
