import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, X } from '../ui/icons';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';

export type AssistantAttachmentValue = { file: File; jobId?: string };

export function AssistantAttachment({
  value,
  busy,
  onRemove,
}: {
  value: AssistantAttachmentValue;
  busy: boolean;
  onRemove: () => void;
}) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!/^image\/(?:png|jpeg|webp|gif|avif|bmp)$/i.test(value.file.type)) return;
    let cancelled = false;
    // Decode pixels and encode a bounded PNG; never expose the original file as a URL.
    void createImageBitmap(value.file)
      .then((bitmap) => {
        try {
          if (cancelled) return;
          const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          setPreview(canvas.toDataURL('image/png'));
        } finally {
          bitmap.close();
        }
      })
      .catch(() => {
        // Unreadable images retain the named, removable file presentation.
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value.file]);
  const size = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    value.file.size / (value.file.size >= 1_048_576 ? 1_048_576 : 1024),
  );
  return (
    <section className="assistant-attachments">
      <div role="group" aria-label={copy.attachedFile} className="assistant-attachment">
        {preview ? (
          <img
            src={preview}
            alt={value.file.name}
            onError={() => setPreview(null)}
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <FileText aria-hidden="true" className="h-8 w-8 shrink-0 text-[var(--color-app-muted)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={value.file.name}>
            {value.file.name}
          </p>
          <p className="text-xs text-[var(--color-app-muted)]">
            {size} {value.file.size >= 1_048_576 ? 'MB' : 'KB'}
          </p>
          {value.jobId && (
            <Link
              to={`/capturar?job=${encodeURIComponent(value.jobId)}`}
              className="text-xs text-[var(--color-accent-primary)] underline underline-offset-4"
            >
              {copy.openCapture}
            </Link>
          )}
        </div>
        {busy && <Spinner size={16} />}
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-full"
          disabled={busy}
          aria-label={copy.removeAttachment}
          onClick={onRemove}
        >
          <X isAnimated={false} className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
