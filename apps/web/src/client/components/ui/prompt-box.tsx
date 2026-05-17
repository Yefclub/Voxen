import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Brain, Loader2, Mic, Square } from 'lucide-react';
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
  placeholder?: string;
  className?: string;
}

export const PromptBox = forwardRef<PromptBoxHandle, PromptBoxProps>(function PromptBox(
  {
    value,
    onChange,
    onSubmit,
    disabled,
    loading,
    thinking,
    onToggleThinking,
    placeholder = 'Pergunte algo sobre seus vídeos…',
    className,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const hasValue = value.trim().length > 0;

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
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
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

  return (
    <div
      className={cn(
        'flex flex-col rounded-[28px] border bg-[var(--color-app-surface)]/70 backdrop-blur-sm transition-colors',
        'border-[var(--color-app-border)] focus-within:border-violet-400/50',
        className,
      )}
    >
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
        className="custom-scrollbar w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-[15px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none leading-relaxed min-h-[44px]"
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
            {recording ? <Square className="h-4 w-4" fill="currentColor" /> : <Mic className="h-4 w-4" />}
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
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
});
