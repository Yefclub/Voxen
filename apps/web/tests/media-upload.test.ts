import { describe, expect, test } from 'bun:test';
import {
  detectUploadKind,
  isSupportedImageFile,
  isSupportedMediaFile,
  parseUploadSourceUrl,
  sanitizeUploadFilename,
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
    expect(detectUploadKind('arquivo.txt', 'text/plain')).toBe(null);
  });

  test('monta e lê sourceUrl interno de upload', () => {
    const uploadId = '123e4567-e89b-12d3-a456-426614174000';
    const sourceUrl = uploadSourceUrl(uploadId, 'aula 01.mp4');
    expect(parseUploadSourceUrl(sourceUrl)).toEqual({ uploadId, filename: 'aula_01.mp4' });
    expect(uploadObjectKey('u1', uploadId, 'aula 01.mp4')).toBe(
      `workspaces/u1/uploads/${uploadId}/aula_01.mp4`,
    );
  });
});
