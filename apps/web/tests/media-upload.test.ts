import { describe, expect, test } from 'bun:test';
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_MEDIA_UPLOAD_BYTES,
  detectUploadKind,
  isSupportedDocumentFile,
  isSupportedImageFile,
  isSupportedMediaFile,
  maxBytesForKind,
  parseUploadSourceUrl,
  sanitizeUploadFilename,
  tooLargeMessageForKind,
  uploadObjectKey,
  uploadSourceUrl,
} from '../src/lib/media-upload';

describe('media-upload helpers', () => {
  test('sanitiza nome de arquivo para chave S3 e sourceUrl', () => {
    expect(sanitizeUploadFilename('../Meu áudio final!!.mp3')).toBe('Meu_audio_final_.mp3');
  });

  test('aceita mimetype de áudio/vídeo e extensão conhecida', () => {
    expect(isSupportedMediaFile('video.mp4', 'video/mp4')).toBe(true);
    expect(isSupportedMediaFile('audio.wav', 'application/octet-stream')).toBe(true);
    expect(isSupportedMediaFile('arquivo.txt', 'text/plain')).toBe(false);
  });

  test('aceita imagens suportadas e classifica upload', () => {
    expect(isSupportedImageFile('print.png', 'image/png')).toBe(true);
    expect(isSupportedImageFile('foto.webp', 'application/octet-stream')).toBe(true);
    expect(isSupportedImageFile('vetor.svg', 'image/svg+xml')).toBe(false);
    expect(detectUploadKind('print.png', 'image/png')).toBe('image');
    expect(detectUploadKind('aula.mp4', 'video/mp4')).toBe('media');
    expect(detectUploadKind('programa.exe', 'application/octet-stream')).toBe(null);
  });

  test('aceita documentos suportados e classifica upload', () => {
    expect(isSupportedDocumentFile('relatorio.pdf', 'application/pdf')).toBe(true);
    expect(isSupportedDocumentFile('planilha.xlsx', 'application/octet-stream')).toBe(true);
    expect(isSupportedDocumentFile('dados.csv', 'text/csv; charset=utf-8')).toBe(true);
    expect(isSupportedDocumentFile('arquivo.zip', 'application/zip')).toBe(false);
    expect(isSupportedDocumentFile('apresentacao.ppt', 'application/octet-stream')).toBe(false);
    expect(isSupportedDocumentFile('texto.rtf', 'application/rtf')).toBe(false);
    expect(isSupportedDocumentFile('script.exe', 'application/octet-stream')).toBe(false);
    expect(detectUploadKind('relatorio.pdf', 'application/pdf')).toBe('document');
    expect(detectUploadKind('notas.md', 'text/markdown')).toBe('document');
  });

  test('monta e lê sourceUrl interno de upload', () => {
    const uploadId = '123e4567-e89b-12d3-a456-426614174000';
    const sourceUrl = uploadSourceUrl(uploadId, 'aula 01.mp4');
    expect(parseUploadSourceUrl(sourceUrl)).toEqual({ uploadId, filename: 'aula_01.mp4' });
    expect(uploadObjectKey('u1', uploadId, 'aula 01.mp4')).toBe(
      `workspaces/u1/uploads/${uploadId}/aula_01.mp4`,
    );
  });

  test('key escopada por userId — client não escolhe path mesmo com nome malicioso', () => {
    const uploadId = '123e4567-e89b-12d3-a456-426614174000';
    // Tentativa de path traversal / escrever em outro workspace é sanitizada.
    const key = uploadObjectKey('userA', uploadId, '../../userB/uploads/x.mp4');
    expect(key.startsWith(`workspaces/userA/uploads/${uploadId}/`)).toBe(true);
    expect(key).not.toContain('userB');
    expect(key).not.toContain('..');
  });

  test('limite por kind', () => {
    expect(maxBytesForKind('image')).toBe(MAX_IMAGE_UPLOAD_BYTES);
    expect(maxBytesForKind('document')).toBe(MAX_DOCUMENT_UPLOAD_BYTES);
    expect(maxBytesForKind('media')).toBe(MAX_MEDIA_UPLOAD_BYTES);
  });

  test('mensagem de tamanho excedido por kind', () => {
    expect(tooLargeMessageForKind('image')).toMatch(/20 MiB/);
    expect(tooLargeMessageForKind('document')).toMatch(/50 MiB/);
    expect(tooLargeMessageForKind('media')).toMatch(/500 MiB/);
  });
});
