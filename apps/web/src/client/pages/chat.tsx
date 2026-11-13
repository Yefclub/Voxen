import {
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatToolCalls,
  useChatStreamScroll,
  useChatNewMessages,
} from '@astryxdesign/core/Chat';
import { useEffect, useRef, useState } from 'react';
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
import { Pencil, Settings, RotateCcw } from '../components/ui/icons';
import { AssistantComposer } from '../components/assistant/assistant-composer';
import { AssistantProposalCard } from '../components/assistant/assistant-proposal';
import { AssistantPreferences } from '../components/assistant/assistant-preferences';
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

  const empty = Boolean(chat.state && !messages.length);
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
    <div data-assistant-workspace className="flex h-full min-h-0 flex-col">
      <header className="mx-auto flex w-full max-w-5xl shrink-0 items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">{copy.title}</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.settings}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </header>
      <section data-chat-stage data-empty={empty ? 'true' : 'false'} className="assistant-stage">
        {empty && (
          <div data-chat-welcome className="mx-auto w-full max-w-[46rem] text-center">
            <h2 className="mx-auto max-w-[22ch] font-heading text-[28px] font-medium leading-[1.15] tracking-tight sm:text-[40px]">
              {copy.empty}
            </h2>
            <p className="mx-auto mt-4 max-w-[50ch] text-base leading-relaxed text-[var(--color-app-muted)]">
              {copy.hint}
            </p>
          </div>
        )}
        <div
          ref={scroll}
          className={empty ? 'hidden' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain'}
        >
          <div ref={newMessages.contentRef}>
            <ChatMessageList
              align="top"
              density="spacious"
              isStreaming={active}
              className="mx-auto w-full max-w-[75ch]"
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
                >
                  <ChatMessageBubble
                    variant={message.role === 'user' ? 'filled' : 'ghost'}
                    width={message.role === 'user' ? undefined : '100%'}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-[var(--color-app-subtle)]">
                        {message.role === 'user' ? copy.user : copy.assistant}
                      </h2>
                      <div className="flex gap-1">
                        {message.role === 'user' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={copy.edit}
                            onClick={() => setEditing({ message, text: message.text })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={copy.prune}
                          onClick={() => setEditing({ message })}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {message.text &&
                      (message.role === 'user' ? (
                        <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
                          {message.text}
                        </p>
                      ) : (
                        <Markdown className="text-base leading-relaxed" headingOffset={2}>
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
                    {Boolean(message.details.references?.length) && (
                      <details className="mt-5 text-sm">
                        <summary className="min-h-11 cursor-pointer py-3 text-[var(--color-app-subtle)]">
                          {copy.sources}
                        </summary>
                        <ul className="space-y-2 pb-2">
                          {message.details.references?.map((reference) => (
                            <li key={reference.href} className="flex items-baseline gap-3">
                              <span className="shrink-0 text-xs text-[var(--color-app-muted)]">
                                {reference.source === 'web' ? copy.web : copy.library}
                              </span>
                              <a
                                className="break-words text-[var(--color-accent-primary)] underline underline-offset-4"
                                href={reference.href}
                                {...(reference.source === 'web'
                                  ? { target: '_blank', rel: 'noopener noreferrer' }
                                  : {})}
                              >
                                {reference.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
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
                    {message.details.model && (
                      <details className="mt-3 text-xs text-[var(--color-app-muted)]">
                        <summary className="min-h-11 cursor-pointer py-3">{copy.usage}</summary>
                        <p className="break-words">
                          {message.details.model}
                          {message.details.costUsd ? ` · USD ${message.details.costUsd}` : ''}
                        </p>
                      </details>
                    )}
                  </ChatMessageBubble>
                </ChatMessage>
              ))}
              {active && chat.activity && (
                <ChatToolCalls
                  label={copy.searching}
                  calls={[{ name: chat.activity, status: 'running' }]}
                />
              )}
              <p role="status" className="min-h-6 text-sm text-[var(--color-app-muted)]">
                {!chat.connected
                  ? copy.reconnecting
                  : active
                    ? chat.activity
                      ? copy.searching
                      : copy.working
                    : ''}
              </p>
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
            />
          </div>
        </div>
        {empty && !text.trim() && (
          <div
            data-chat-suggestions
            className="mx-auto max-w-[46rem] flex-wrap justify-center gap-2"
          >
            <Button variant="outline" size="sm" onClick={() => setText(copy.recentPrompt)}>
              {copy.recentSuggestion}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setText(copy.connectPrompt)}>
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
