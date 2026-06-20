import { useState } from 'react';
import type { ReactElement } from 'react';
import { Maximize2, Music2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { useI18n } from '../../lib/i18n';
import { uploadMediaKind } from '../../lib/media-kind';

interface UploadMediaViewerProps {
  transcriptId: string;
  /** MIME do arquivo original (video/*, audio/*, image/*). */
  mimeType: string;
  /** Fallback visual (poster de vídeo / preview de áudio). */
  previewSrc: string;
  title: string;
}

/**
 * Player/visualizador para mídia enviada por upload. O `<video>`/`<audio>`
 * aponta para `/api/transcripts/:id/original`, que serve a mídia autenticada com
 * suporte a HTTP Range (seek). Imagens abrem em lightbox.
 */
export function UploadMediaViewer({
  transcriptId,
  mimeType,
  previewSrc,
  title,
}: UploadMediaViewerProps): ReactElement {
  const { t } = useI18n();
  const [lightbox, setLightbox] = useState(false);
  const src = `/api/transcripts/${transcriptId}/original`;
  const kind = uploadMediaKind(mimeType);

  if (kind === 'video') {
    return (
      <video
        controls
        preload="metadata"
        poster={previewSrc}
        src={src}
        className="aspect-video w-full bg-black"
      />
    );
  }

  if (kind === 'audio') {
    return (
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--color-app-muted)]">
          <Music2 className="h-4 w-4 text-emerald-400" />
          {t('library.audioUpload')}
        </div>
        <audio controls preload="metadata" src={src} className="w-full" />
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="group relative block w-full"
          aria-label={t('library.viewImage')}
        >
          <img
            src={src}
            alt={title}
            className="max-h-[420px] w-full object-contain"
            loading="lazy"
          />
          <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-4 w-4" />
          </span>
        </button>
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="max-w-[92vw] border-0 bg-transparent p-0 shadow-none sm:max-w-5xl">
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <img
              src={src}
              alt={title}
              onClick={() => setLightbox(false)}
              className="max-h-[88dvh] w-full cursor-zoom-out rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Fallback (não esperado para uploads): thumbnail estático.
  return (
    <img src={previewSrc} alt="" className="aspect-video w-full object-cover" loading="lazy" />
  );
}
