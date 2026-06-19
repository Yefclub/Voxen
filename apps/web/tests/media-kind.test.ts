import { describe, expect, it } from 'bun:test';
import { uploadMediaKind } from '../src/client/lib/media-kind';

describe('uploadMediaKind', () => {
  it('classifica vídeo', () => expect(uploadMediaKind('video/mp4')).toBe('video'));
  it('classifica áudio', () => expect(uploadMediaKind('audio/mpeg')).toBe('audio'));
  it('classifica imagem', () => expect(uploadMediaKind('image/png')).toBe('image'));
  it('documento vira other', () => expect(uploadMediaKind('application/pdf')).toBe('other'));
  it('vazio vira other', () => expect(uploadMediaKind('')).toBe('other'));
});
