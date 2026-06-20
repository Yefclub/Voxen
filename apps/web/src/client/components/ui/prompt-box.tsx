import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  AtSign,
  Brain,
  FileText,
  ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Spinner } from './spinner';
import { createVoiceRecorder } from '../../lib/voice-recorder';
import { toast } from 'sonner';
import { useI18n } from '../../lib/i18n';

export interface PromptBoxHandle {
  focus: () => void;
  setValue: (v: string) => void;
}

export interface LibraryMentionItem {
  type: 'transcript' | 'note';
  id: string;
  label: string;
  subtitle?: string;
}

interface PromptBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
  thinking: boolean;
  onToggleThinking: () => void;
  // Vision: imagem anexada como data URL (base64). Quando setada, prompt-box
  // mostra preview; envio inclui no payload e o chat service usa o modelo
  // de visão. Vazio = chat text-only normal.
  attachedImage?: string | null;
  onAttachImage?: (dataUrl: string) => void;
  onClearImage?: () => void;
  visionEnabled?: boolean;
  selectedMentions?: LibraryMentionItem[];
  onMentionSelect?: (item: LibraryMentionItem) => void;
  onMentionRemove?: (item: LibraryMentionItem) => void;
  uploadEnabled?: boolean;
  uploadingFile?: boolean;
  onUploadFile?: (file: File) => void;
  placeholder?: string;
  className?: string;
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const PromptBox = forwardRef<PromptBoxHandle, PromptBoxProps>(function PromptBox(
  {
    value,
    onChange,
    onSubmit,
    disabled,
    loading,
    thinking,
    onToggleThinking,
    attachedImage,
    onAttachImage,
    onClearImage,
    visionEnabled = false,
    selectedMentions = [],
    onMentionSelect,
    onMentionRemove,
    uploadEnabled = false,
    uploadingFile = false,
    onUploadFile,
    placeholder,
    className,
  },
  ref,
) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [mentionResults, setMentionResults] = useState<LibraryMentionItem[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionActive, setMentionActive] = useState(0);
  const hasValue = value.trim().length > 0 || !!attachedImage;

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (v) => {
      onChange(v);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }));

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, 220);
    ta.style.height = `${next}px`;
    // Só mostra a scrollbar quando o conteúdo ultrapassa o cap. Sem isso, o
    // browser pinta uma scrollbar fantasma assim que o textarea ganha foco.
    ta.style.overflowY = ta.scrollHeight > 220 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    if (mentionQuery === null || !onMentionSelect) {
      setMentionResults([]);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setMentionLoading(true);
      fetch(`/api/chat/library-mentions?q=${encodeURIComponent(mentionQuery)}`, {
        credentials: 'include',
        signal: ac.signal,
      })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: LibraryMentionItem[] }) => {
          setMentionResults(Array.isArray(d.items) ? d.items : []);
          setMentionActive(0);
        })
        .catch(() => {
          if (!ac.signal.aborted) setMentionResults([]);
        })
        .finally(() => {
          if (!ac.signal.aborted) setMentionLoading(false);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [mentionQuery, onMentionSelect]);

  // Cleanup no unmount: se o usuário sair do chat gravando, o MediaRecorder e o
  // stream do microfone continuariam ativos. `cancel()` para o recorder e libera
  // as tracks sem disparar transcrição.
  useEffect(() => {
    return () => {
      if (recorderRef.current?.isRecording()) {
        recorderRef.current.cancel();
      }
      recorderRef.current = null;
    };
  }, []);

  async function toggleRecord(): Promise<void> {
    if (recording) {
      const rec = recorderRef.current;
      if (!rec) {
        setRecording(false);
        return;
      }
      try {
        const blob = await rec.stop();
        setRecording(false);
        await sendVoice(blob);
      } catch (e) {
        setRecording(false);
        toast.error(t('prompt.recordFinishError'), {
          description: e instanceof Error ? e.message : undefined,
        });
      }
      return;
    }
    try {
      const rec = createVoiceRecorder();
      await rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      toast.error(t('prompt.microphoneError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function sendVoice(blob: Blob): Promise<void> {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append('audio', new File([blob], 'voice.webm', { type: blob.type }));
      const res = await fetch('/api/chat/voice', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t('prompt.voiceTranscribeError'));
        return;
      }
      const text = (data.text ?? '').trim();
      if (!text) {
        toast.warning(t('prompt.voiceEmpty'));
        return;
      }
      onChange(value ? value + ' ' + text : text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (e) {
      toast.error(t('prompt.voiceNetworkError'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setTranscribing(false);
    }
  }

  function onPickImage(): void {
    if (!visionEnabled) {
      toast.warning(t('prompt.visionMissing'), {
        description: t('prompt.visionMissingDescription'),
      });
      return;
    }
    fileInputRef.current?.click();
  }

  function onPickUpload(): void {
    if (!uploadEnabled) {
      toast.warning(t('prompt.documentsMissing'), {
        description: t('prompt.documentsMissingDescription'),
      });
      return;
    }
    uploadInputRef.current?.click();
  }

  function onImageChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar mesmo arquivo
    if (!file) return;
    if (!IMAGE_ALLOWED_MIMES.has(file.type)) {
      toast.error(t('chat.unsupportedFormat'), {
        description: t('chat.acceptedImages'),
      });
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error(t('chat.imageTooLarge'), { description: t('prompt.imageLimit') });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string') {
        onAttachImage?.(dataUrl);
      }
    };
    reader.onerror = () => {
      toast.error(t('prompt.readImageError'));
    };
    reader.readAsDataURL(file);
  }

  function onUploadChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onUploadFile?.(file);
  }

  function handleTextChange(next: string, caret: number | null): void {
    onChange(next);
    const detected = detectMentionQuery(next, caret ?? next.length);
    setMentionQuery(detected?.query ?? null);
    setMentionRange(detected ? { start: detected.start, end: detected.end } : null);
  }

  function selectMention(item: LibraryMentionItem): void {
    if (!mentionRange) return;
    const before = value.slice(0, mentionRange.start);
    const after = value.slice(mentionRange.end);
    const token = `@${item.label}`;
    const next = `${before}${token} ${after}`.replace(/\s+$/, ' ');
    onChange(next);
    onMentionSelect?.(item);
    setMentionQuery(null);
    setMentionRange(null);
    setMentionResults([]);
    requestAnimationFrame(() => {
      const caret = before.length + token.length + 1;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-[28px] border bg-[var(--color-app-surface)]/70 backdrop-blur-sm transition-colors',
        'border-[var(--color-app-border)] focus-within:border-violet-400/50',
        className,
      )}
    >
      <AnimatePresence>
        {(mentionQuery !== null || mentionResults.length > 0) && onMentionSelect && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="absolute left-3 right-3 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-app-border)] px-3 py-2 text-[11px] uppercase tracking-wider text-[var(--color-app-muted)]">
              <AtSign className="h-3.5 w-3.5" />
              {t('prompt.mentionLibrary')}
              {mentionLoading && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
            </div>
            {mentionResults.length === 0 ? (
              <div className="px-3 py-3 text-xs text-[var(--color-app-muted)]">
                {mentionLoading ? t('prompt.searching') : t('prompt.noMentionResults')}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto py-1">
                {mentionResults.map((item, index) => (
                  <button
                    type="button"
                    key={`${item.type}:${item.id}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectMention(item)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                      index === mentionActive
                        ? 'bg-[var(--color-app-surface-hover)] text-zinc-100'
                        : 'text-zinc-200 hover:bg-[var(--color-app-surface-hover)]',
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      {item.subtitle && (
                        <span className="block truncate text-[11px] text-[var(--color-app-muted)]">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Preview da imagem anexada */}
      <AnimatePresence>
        {attachedImage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 pt-3 overflow-hidden"
          >
            <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-1.5 pr-2.5">
              <img
                src={attachedImage}
                alt={t('prompt.imageAttached')}
                className="h-12 w-12 rounded-md object-cover"
              />
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-wider text-violet-300 font-medium">
                  {t('prompt.imageAttached')}
                </span>
                <span className="text-[10px] text-[var(--color-app-muted)]">
                  {t('prompt.imageAttachedHint')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onClearImage?.()}
                className="ml-2 h-6 w-6 flex items-center justify-center rounded-md text-[var(--color-app-muted)] hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                aria-label={t('prompt.removeImage')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {selectedMentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {selectedMentions.map((item) => (
            <span
              key={`${item.type}:${item.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200"
            >
              <AtSign className="h-3 w-3" />
              {item.label}
              <button
                type="button"
                onClick={() => onMentionRemove?.(item)}
                className="rounded-full text-emerald-200/70 hover:text-emerald-100"
                aria-label={t('prompt.removeMention', { label: item.label })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={onImageChange}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,text/html,application/json,application/xml,application/epub+zip,.pdf,.docx,.pptx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html,.htm,.epub"
        className="hidden"
        onChange={onUploadChange}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => handleTextChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (mentionResults.length > 0 && mentionQuery !== null) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setMentionActive((i) => Math.min(i + 1, mentionResults.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setMentionActive((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              selectMention(mentionResults[mentionActive]!);
              return;
            }
            if (e.key === 'Escape') {
              setMentionQuery(null);
              setMentionResults([]);
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (hasValue && !disabled) onSubmit();
          }
        }}
        placeholder={placeholder ?? t('prompt.placeholder')}
        rows={1}
        className="w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-[15px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none leading-relaxed overflow-hidden"
        disabled={disabled}
      />
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        {/* Thinking toggle */}
        <button
          type="button"
          onClick={onToggleThinking}
          className={cn(
            'flex items-center gap-1.5 h-8 rounded-full px-3 text-xs font-medium transition-colors',
            thinking
              ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
              : 'border border-[var(--color-app-border)] text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface-hover)]',
          )}
          aria-pressed={thinking}
          title={thinking ? t('prompt.thinkingOn') : t('prompt.thinkingOff')}
        >
          <Brain className="h-3.5 w-3.5" />
          {t('prompt.think')}
        </button>

        {/* Recording indicator */}
        <AnimatePresence>
          {recording && (
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              className="flex items-center gap-2 text-[11px] text-rose-300"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              {t('prompt.recording')}
            </motion.div>
          )}
          {transcribing && !recording && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-[11px] text-[var(--color-app-muted)]"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('prompt.transcribing')}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Document upload */}
          <button
            type="button"
            onClick={onPickUpload}
            disabled={loading || uploadingFile}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              uploadEnabled
                ? 'text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface-hover)]'
                : 'text-[var(--color-app-muted)]/40 cursor-not-allowed',
              (loading || uploadingFile) && 'opacity-40 cursor-not-allowed',
            )}
            aria-label={t('prompt.uploadDocument')}
            title={
              uploadEnabled ? t('prompt.uploadDocumentTitle') : t('prompt.documentModelMissing')
            }
          >
            {uploadingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </button>

          {/* Image upload */}
          <button
            type="button"
            onClick={onPickImage}
            disabled={loading || !!attachedImage}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              visionEnabled
                ? 'text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface-hover)]'
                : 'text-[var(--color-app-muted)]/40 cursor-not-allowed',
              attachedImage && 'opacity-40 cursor-not-allowed',
              loading && 'opacity-40 cursor-not-allowed',
            )}
            aria-label={t('prompt.attachImage')}
            title={visionEnabled ? t('prompt.attachImageTitle') : t('prompt.visionModelMissing')}
          >
            <ImageIcon className="h-4 w-4" />
          </button>

          {/* Mic */}
          <button
            type="button"
            onClick={() => void toggleRecord()}
            disabled={transcribing || loading}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              recording
                ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                : 'text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface-hover)]',
              (transcribing || loading) && 'opacity-40 cursor-not-allowed',
            )}
            aria-label={recording ? t('prompt.stopRecording') : t('prompt.recordVoice')}
            title={recording ? t('prompt.stopRecording') : t('prompt.recordVoice')}
          >
            {recording ? (
              <Square className="h-4 w-4" fill="currentColor" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          {/* Send. Durante streaming o botão mantém o fundo claro com o
              Spinner orbital (Motion) — o Loader2 com animate-spin ficava
              cinza sobre fundo escuro e parecia um loader travado, além de
              congelar os primeiros ~600ms no WebKit. */}
          <button
            type="button"
            onClick={() => {
              if (hasValue && !disabled) onSubmit();
            }}
            disabled={!hasValue || disabled}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-all',
              loading
                ? 'bg-zinc-100 text-zinc-900 cursor-wait'
                : hasValue && !disabled
                  ? 'bg-zinc-100 text-zinc-900 hover:bg-white active:scale-95'
                  : 'bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)] cursor-not-allowed',
            )}
            aria-label={t('prompt.send')}
            aria-busy={loading || undefined}
          >
            {loading ? <Spinner size={16} /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
});

function detectMentionQuery(
  value: string,
  caret: number,
): { query: string; start: number; end: number } | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,48})$/.exec(before);
  if (!match) return null;
  const token = match[2] ?? '';
  return {
    query: token,
    start: before.length - token.length - 1,
    end: caret,
  };
}
