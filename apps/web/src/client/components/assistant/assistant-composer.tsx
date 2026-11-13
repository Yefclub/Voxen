import { useRef } from 'react';
import { ChatComposer, ChatComposerInput, ChatSendButton } from '@astryxdesign/core/Chat';
import { Button } from '../ui/button';
import { Paperclip, Square } from '../ui/icons';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSend: () => Promise<void>;
  onStop: () => void;
  onFile: (file: File) => Promise<void>;
  busy: boolean;
  active: boolean;
  ready: boolean;
};

export function AssistantComposer(props: Props) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const input = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (
      !props.ready ||
      props.busy ||
      props.active ||
      !props.value.trim() ||
      props.value.length > 16_000
    )
      return;
    void props.onSend();
  };
  return (
    <>
      <ChatComposer
        className="assistant-composer"
        elevation="none"
        value={props.value}
        onChange={props.onChange}
        onSubmit={submit}
        isDisabled={props.busy}
        isStopShown={props.active}
        onStop={props.onStop}
        input={
          <ChatComposerInput
            label={copy.message}
            placeholder={copy.placeholder}
            className="min-h-14 text-base"
            maxRows={8}
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
        footerActions={
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={input}
              type="file"
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
              aria-label={copy.attach}
              disabled={props.busy || props.active}
              onClick={() => input.current?.click()}
            >
              <Paperclip className="h-5 w-5" />
            </Button>
          </div>
        }
        sendButton={
          <ChatSendButton
            aria-label={props.active ? copy.stop : copy.send}
            onSend={submit}
            onStop={props.onStop}
            isDisabled={
              !props.active &&
              (!props.ready || !props.value.trim() || props.value.length > 16_000 || props.busy)
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
        }
      />
    </>
  );
}
