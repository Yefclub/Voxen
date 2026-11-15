import {
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  useChatStreamScroll,
  useChatNewMessages,
} from '@astryxdesign/core/Chat';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Markdown } from '../components/ui/markdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Search, Link2 } from '../components/ui/icons';
import { AssistantComposer } from '../components/assistant/assistant-composer';
import { AssistantProposalCard } from '../components/assistant/assistant-proposal';
import { AssistantPreferences } from '../components/assistant/assistant-preferences';
import { AssistantProgress } from '../components/assistant/assistant-progress';
import { AssistantMessageFooter } from '../components/assistant/assistant-message-footer';
import { useAssistant, type AssistantMessage } from '../lib/use-assistant';
import { assistantCopy } from '../lib/assistant-i18n';
import { useI18n } from '../lib/i18n';

export function ChatPage(): React.ReactElement {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const chat = useAssistant();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<{ message: AssistantMessage; text?: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const nonce = useRef<{ text: string; id: string } | null>(null);
  const uploading = useRef(false);
  const active = Boolean(chat.state?.activeRun);
  const messages = chat.state?.messages ?? [];
  const progressLabel = !chat.connected
    ? copy.reconnecting
    : active
      ? messages.at(-1)?.text
        ? copy.writing
        : copy.working
      : '';

  const empty = Boolean(chat.state && !messages.length);
  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    const measure = () =>
      viewport.parentElement?.style.setProperty(
        '--assistant-scrollbar-width',
        `${viewport.offsetWidth - viewport.clientWidth}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [empty]);
  const scrollControl = useChatStreamScroll({ scrollRef: scroll });
  const newMessages = useChatNewMessages({
    isLocked: scrollControl.isLocked,
    onResize: scrollControl.scrollIfLocked,
  });
  const jumpToEnd = () => scrollControl.scrollToBottom({ behavior: 'instant' });
  useEffect(() => {
    setNotice('');
  }, [chat.state?.revision]);
  function errorText(code: string) {
    if (code === 'AI_NOT_CONFIGURED') return copy.noKey;
    if (code === 'REVISION_CONFLICT' || code === 'RUN_ACTIVE') return copy.conflict;
    if (code === 'INTERRUPTED') return copy.interrupted;
    if (code === 'CONTEXT_LIMIT') return copy.contextLimit;
    if (code === 'ASSISTANT_UNAVAILABLE') return copy.unavailable;
    return copy.failed;
  }
  async function send() {
    const value = text.trim();
    if (!value || active || busy || !chat.state) return;
    if (value.length > 16_000) {
      setNotice(copy.tooLong);
      return;
    }
    setBusy(true);
    setNotice('');
    jumpToEnd();
    if (!nonce.current || nonce.current.text !== value)
      nonce.current = { text: value, id: crypto.randomUUID() };
    try {
      await chat.send(value, nonce.current.id);
      setText('');
      nonce.current = null;
    } catch (error) {
      setNotice(errorText(error instanceof Error ? error.message : ''));
    } finally {
      setBusy(false);
    }
  }
  async function rewind() {
    if (!editing || busy) return;
    setBusy(true);
    setNotice('');
    try {
      await chat.rewind(editing.message.id, editing.text);
      setEditing(null);
      jumpToEnd();
    } catch (error) {
      setNotice(errorText(error instanceof Error ? error.message : ''));
    } finally {
      setBusy(false);
    }
  }
  async function attach(file: File) {
    if (uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setNotice(copy.uploading);
    try {
      const body = new FormData();
      body.set('file', file);
      const response = await fetch('/api/captures/upload', {
        method: 'POST',
        body,
        credentials: 'include',
      });
      const result = (await response.json()) as { job?: { id: string } };
      if (!response.ok || !result.job) throw new Error('UPLOAD_FAILED');
      setText(
        (current) =>
          `${current}${current ? '\n' : ''}${copy.attachment}: ${file.name.slice(0, 200)}. capture_job_id=${result.job!.id}`,
      );
      setNotice(copy.attachment);
    } catch {
      setNotice(copy.fileError);
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  return (
    <div data-assistant-workspace className="relative flex h-full min-h-0 flex-col">
      <h1 className="sr-only">{copy.title}</h1>
      <p
        data-chat-announcement
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {progressLabel}
      </p>
      <section data-chat-stage data-empty={empty ? 'true' : 'false'} className="assistant-stage">
        {empty && (
          <div data-chat-welcome className="mx-auto w-full max-w-[46rem] text-center">
            <h2 className="mx-auto max-w-[24ch] font-heading text-[28px] font-medium leading-tight tracking-tight">
              {copy.empty}
            </h2>
            <p className="sr-only">{copy.hint}</p>
          </div>
        )}
        <div
          ref={scroll}
          className={
            empty
              ? 'hidden'
              : 'assistant-transcript min-h-0 flex-1 overflow-y-auto overscroll-contain'
          }
        >
          <div ref={newMessages.contentRef}>
            <ChatMessageList
              align="top"
              density="spacious"
              isStreaming={active}
              className="assistant-messages mx-auto w-full max-w-[46rem]"
            >
              {chat.state?.hasMore && (
                <Button
                  variant="ghost"
                  className="my-3"
                  onClick={() => {
                    const before = scroll.current?.scrollHeight ?? 0;
                    void chat.loadOlder().then(() =>
                      requestAnimationFrame(() => {
                        if (scroll.current)
                          scroll.current.scrollTop += scroll.current.scrollHeight - before;
                      }),
                    );
                  }}
                >
                  {copy.older}
                </Button>
              )}
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  sender={message.role === 'user' ? 'user' : 'assistant'}
                  density="spacious"
                  className="assistant-message"
                >
                  <ChatMessageBubble
                    className="assistant-bubble"
                    variant={message.role === 'user' ? 'filled' : 'ghost'}
                    width={message.role === 'user' ? undefined : '100%'}
                    metadata={
                      <AssistantMessageFooter
                        message={message}
                        onEdit={(message) => setEditing({ message, text: message.text })}
                        onRewind={(message) => setEditing({ message })}
                      />
                    }
                  >
                    <h2 className="sr-only">
                      {message.role === 'user' ? copy.user : copy.assistant}
                    </h2>
                    {message.text &&
                      (message.role === 'user' ? (
                        <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
                          {message.text}
                        </p>
                      ) : (
                        <Markdown
                          className="assistant-answer text-base leading-relaxed"
                          headingOffset={2}
                        >
                          {message.text}
                        </Markdown>
                      ))}
                    {message.details.error && (
                      <p
                        role="status"
                        className="mt-4 text-sm leading-relaxed text-[var(--color-app-warning-fg)]"
                      >
                        {errorText(message.details.error)}
                      </p>
                    )}
                    {message.details.stopped && (
                      <p
                        role="status"
                        className="mt-4 text-sm leading-relaxed text-[var(--color-app-muted)]"
                      >
                        {copy.stopped}
                      </p>
                    )}
                    {message.details.proposals?.map((proposal) => (
                      <AssistantProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        revision={chat.state?.revision ?? 0}
                        disabled={active}
                        onDecision={chat.decide}
                      />
                    ))}
                    {Boolean(message.details.actions?.length) && (
                      <div className="mt-4 space-y-2 text-sm">
                        <p className="font-medium">{copy.actions}</p>
                        {message.details.actions?.map((action, index) => (
                          <p key={`${action.name}-${index}`}>
                            <Link
                              className="text-[var(--color-accent-primary)] underline underline-offset-4"
                              to={
                                action.result.href ??
                                (action.result.jobId
                                  ? `/capturar?job=${encodeURIComponent(action.result.jobId)}`
                                  : '/capturar')
                              }
                            >
                              {action.result.title ??
                                (action.name === 'create_note' ? copy.openNote : copy.openCapture)}
                            </Link>
                          </p>
                        ))}
                      </div>
                    )}
                  </ChatMessageBubble>
                </ChatMessage>
              ))}
              {(active || !chat.connected) && (
                <AssistantProgress
                  activity={chat.activity}
                  connected={chat.connected}
                  label={progressLabel}
                  model={chat.state?.activeRun?.model ?? null}
                />
              )}
            </ChatMessageList>
          </div>
        </div>
        <div className="assistant-dock">
          <div className="mx-auto w-full max-w-[46rem]">
            {(scrollControl.isScrolledUp || newMessages.hasNewMessages) && (
              <div className="mb-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    newMessages.dismiss();
                    scrollControl.scrollToBottom();
                  }}
                >
                  {copy.jump}
                </Button>
              </div>
            )}
            {(notice || chat.error) && (
              <p
                role="status"
                className="mb-3 text-sm leading-relaxed text-[var(--color-app-warning-fg)]"
              >
                {notice || errorText(chat.error ?? '')}{' '}
                {(notice === copy.noKey || chat.error === 'AI_NOT_CONFIGURED') && (
                  <Link className="underline underline-offset-4" to="/conta/ia">
                    {copy.configure}
                  </Link>
                )}
                {chat.error && (
                  <Button variant="ghost" size="sm" onClick={() => void chat.refresh()}>
                    {copy.retry}
                  </Button>
                )}
              </p>
            )}
            <AssistantComposer
              value={text}
              onChange={setText}
              onSend={send}
              onStop={() => {
                void chat.stop().catch(() => setNotice(copy.failed));
              }}
              onFile={attach}
              busy={busy}
              active={active}
              ready={Boolean(chat.state)}
              onPreferences={() => setSettingsOpen(true)}
            />
          </div>
        </div>
        {empty && !text.trim() && (
          <div
            data-chat-suggestions
            className="assistant-suggestions mx-auto w-full max-w-[46rem] flex-col"
          >
            <Button variant="ghost" size="sm" onClick={() => setText(copy.recentPrompt)}>
              <Search className="h-4 w-4 shrink-0" />
              {copy.recentSuggestion}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setText(copy.connectPrompt)}>
              <Link2 className="h-4 w-4 shrink-0" />
              {copy.connectSuggestion}
            </Button>
          </div>
        )}
      </section>
      <AssistantPreferences open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="pr-12">
            <DialogTitle>{editing?.text !== undefined ? copy.edit : copy.rewindTitle}</DialogTitle>
            <DialogDescription>{copy.rewindHint}</DialogDescription>
          </DialogHeader>
          {editing?.text !== undefined && (
            <>
              <Textarea
                aria-label={copy.message}
                value={editing.text}
                maxLength={16_000}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, text: event.target.value } : null,
                  )
                }
              />
              <p className="text-sm text-[var(--color-app-muted)]">{copy.editHint}</p>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {copy.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={busy || editing?.text === ''}
              onClick={() => void rewind()}
            >
              {editing?.text !== undefined ? copy.saveEdit : copy.confirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
