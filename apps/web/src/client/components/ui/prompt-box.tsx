import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Brain, ImageIcon, Loader2, Mic, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { createVoiceRecorder } from '../../lib/voice-recorder';
import { toast } from 'sonner';

export interface PromptBoxHandle {
  focus: () => void;
  setValue: (v: string) => void;
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
    placeholder = 'Pergunte qualquer coisa pra Vox…',
    className,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
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

  async function toggleRecord(): Promise<void> {
    if (recording) {
      try {
        const blob = await recorderRef.current!.stop();
        setRecording(false);
        await sendVoice(blob);
      } catch (e) {
        setRecording(false);
        toast.error('Falha ao finalizar gravação.', {
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
      toast.error('Não foi possível acessar o microfone.', {
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
        toast.error(data.error ?? 'Falha ao transcrever áudio.');
        return;
      }
      const text = (data.text ?? '').trim();
      if (!text) {
        toast.warning('Não consegui entender o áudio. Tente de novo.');
        return;
      }
      onChange(value ? value + ' ' + text : text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (e) {
      toast.error('Erro de rede ao enviar áudio.', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setTranscribing(false);
    }
  }

  function onPickImage(): void {
    if (!visionEnabled) {
      toast.warning('Visão não configurada.', {
        description: 'Admin precisa escolher um modelo de visão em /setup.',
      });
      return;
    }
    fileInputRef.current?.click();
  }

  function onImageChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar mesmo arquivo
    if (!file) return;
    if (!IMAGE_ALLOWED_MIMES.has(file.type)) {
      toast.error('Formato não suportado.', {
        description: 'Aceito: PNG, JPEG, WebP, GIF.',
      });
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('Imagem muito grande.', { description: 'Limite de 5MB.' });
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
      toast.error('Falha ao ler imagem.');
    };
    reader.readAsDataURL(file);
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-[28px] border bg-[var(--color-app-surface)]/70 backdrop-blur-sm transition-colors',
        'border-[var(--color-app-border)] focus-within:border-violet-400/50',
        className,
      )}
    >
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
              <img src={attachedImage} alt="Anexo" className="h-12 w-12 rounded-md object-cover" />
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-wider text-violet-300 font-medium">
                  Imagem anexada
                </span>
                <span className="text-[10px] text-[var(--color-app-muted)]">
                  Vox vai analisar com modelo de visão
                </span>
              </div>
              <button
                type="button"
                onClick={() => onClearImage?.()}
                className="ml-2 h-6 w-6 flex items-center justify-center rounded-md text-[var(--color-app-muted)] hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                aria-label="Remover imagem"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={onImageChange}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (hasValue && !disabled) onSubmit();
          }
        }}
        placeholder={placeholder}
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
          title={thinking ? 'Raciocínio ativado' : 'Ativar raciocínio extra'}
        >
          <Brain className="h-3.5 w-3.5" />
          Pensar
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
              Gravando…
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
              Transcrevendo…
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-auto flex items-center gap-1.5">
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
            aria-label="Anexar imagem"
            title={
              visionEnabled
                ? 'Anexar imagem (PNG/JPEG/WebP/GIF, máx 5MB)'
                : 'Modelo de visão não configurado'
            }
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
            aria-label={recording ? 'Parar gravação' : 'Gravar voz'}
            title={recording ? 'Parar gravação' : 'Gravar voz'}
          >
            {recording ? (
              <Square className="h-4 w-4" fill="currentColor" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          {/* Send */}
          <button
            type="button"
            onClick={() => {
              if (hasValue && !disabled) onSubmit();
            }}
            disabled={!hasValue || disabled}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-all',
              hasValue && !disabled
                ? 'bg-zinc-100 text-zinc-900 hover:bg-white active:scale-95'
                : 'bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)] cursor-not-allowed',
            )}
            aria-label="Enviar"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
