import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { jobTypeLabel, stageLabel } from './job-display';
import { parseUploadSourceUrl, uploadSourceUrl } from '../../lib/media-upload';

const routeSource = readFileSync(new URL('../../routes/saved-media.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../pages/saved-media.tsx', import.meta.url), 'utf8');

describe('saved media contract', () => {
  test('reuses a private stored object when transcription is requested', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseUploadSourceUrl(uploadSourceUrl(id, 'video.mp4'))).toEqual({
      uploadId: id,
      filename: 'video.mp4',
    });
    expect(routeSource).toContain("type: 'UPLOAD_AND_TRANSCRIBE'");
    expect(routeSource).toContain('savedMediaId: media.id');
  });

  test('keeps list, stream, process and delete lookups scoped to the user', () => {
    expect(routeSource).toContain('where: { id, userId }');
    expect(routeSource).toContain('WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE');
  });

  test('exposes readable queue labels for every download stage', () => {
    expect(jobTypeLabel('DOWNLOAD_MEDIA')).toBe('Download de mídia');
    expect(stageLabel('probing_media')).toBe('Lendo dados da mídia');
    expect(stageLabel('downloading_media')).toBe('Baixando mídia');
    expect(stageLabel('storing_media')).toBe('Salvando mídia');
    expect(stageLabel('media_ready')).toBe('Mídia pronta');
  });

  test('keeps every saved item reachable through paginated navigation', () => {
    expect(pageSource).toContain('offset=${page * PAGE_SIZE}');
    expect(pageSource).toContain("t('savedMedia.previous')");
    expect(pageSource).toContain("t('savedMedia.next')");
    expect(pageSource).toContain('Math.ceil(data.total / PAGE_SIZE)');
  });
});
