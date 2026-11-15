import { useLayoutEffect, useRef, useState } from 'react';
import { ChatComposer, ChatComposerInput, ChatSendButton } from '@astryxdesign/core/Chat';
import { Button } from '../ui/button';
import { Plus, Settings, Square } from '../ui/icons';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';
import { CAPTURE_FILE_ACCEPT } from '../../lib/capture-state';
import { AssistantAttachment, type AssistantAttachmentValue } from './assistant-attachment';

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSend: () => Promise<void>;
  onStop: () => void;
  onFile: (file: File) => Promise<void>;
  busy: boolean;
  active: boolean;
  ready: boolean;
  onPreferences: () => void;
  attachment: AssistantAttachmentValue | null;
  onRemoveAttachment: () => void;
};

export function AssistantComposer(props: Props) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const input = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const editor = composer.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!editor) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(editor).lineHeight);
      if (
        editor.textContent?.length &&
        line > 0 &&
        Math.max(editor.getBoundingClientRect().height, editor.scrollHeight) > line * 1.5
      )
        setExpanded(true);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!props.value.length) setExpanded(false);
    else if (props.value.includes('\n')) setExpanded(true);
  }, [props.value]);
  const submit = () => {
    if (
      !props.ready ||
      props.busy ||
      props.active ||
      (!props.value.trim() && !props.attachment) ||
      props.value.length > 16_000
    )
      return;
    void props.onSend();
  };
  return (
    <>
      <ChatComposer
        ref={composer}
        className="assistant-composer"
        data-expanded={expanded ? 'true' : 'false'}
        data-has-attachment={props.attachment ? 'true' : 'false'}
        density="compact"
        elevation="none"
        value={props.value}
        onChange={props.onChange}
        onSubmit={submit}
        isDisabled={props.busy}
        isStopShown={props.active}
        onStop={props.onStop}
        drawer={
          props.attachment && (
            <AssistantAttachment
              value={props.attachment}
              busy={props.busy}
              onRemove={() => {
                props.onRemoveAttachment();
                composer.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
              }}
            />
          )
        }
        input={
          <ChatComposerInput
            label={copy.message}
            placeholder={copy.placeholder}
            className="assistant-composer-input text-base"
            maxRows={6}
            hasHistory={false}
            pasteAsToken={false}
            onSubmit={submit}
            enterKeyHint="enter"
            onFiles={(files) => {
              if (files[0]) void props.onFile(files[0]);
            }}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return;
              // Own submission so a rejected request never clears the native input.
              event.preventDefault();
              if (window.matchMedia('(pointer: coarse)').matches) {
                // The contenteditable command preserves the browser's undo history
                // and emits the native input event consumed by ChatComposerInput.
                document.execCommand('insertLineBreak');
              } else submit();
            }}
          />
        }
        headerActions={
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={input}
              type="file"
              accept={CAPTURE_FILE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void props.onFile(file).finally(() => {
                    if (input.current) input.current.value = '';
                  });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full"
              aria-label={copy.attach}
              disabled={props.busy || props.active}
              onClick={() => input.current?.click()}
            >
              <Plus isAnimated={false} className="h-5 w-5" />
            </Button>
          </div>
        }
        sendButton={
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full text-[var(--color-app-muted)]"
              aria-label={copy.settings}
              onClick={props.onPreferences}
            >
              <Settings isAnimated={false} className="h-5 w-5" />
            </Button>
            <ChatSendButton
              aria-label={props.active ? copy.stop : copy.send}
              onSend={submit}
              onStop={props.onStop}
              isDisabled={
                !props.active &&
                (!props.ready ||
                  (!props.value.trim() && !props.attachment) ||
                  props.value.length > 16_000 ||
                  props.busy)
              }
              sendIcon={
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                  <path
                    d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
              stopIcon={<Square className="h-4 w-4" />}
              className="h-11 min-h-11 w-11 min-w-11 rounded-full"
            />
          </div>
        }
      />
    </>
  );
}
