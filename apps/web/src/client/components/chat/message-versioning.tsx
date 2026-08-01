// ============================================================================
// Controles de versionamento da mensagem do usuário (spec 127, Parte 2)
// ----------------------------------------------------------------------------
// Duas peças, o padrão convergente de ChatGPT/Claude/Orbital:
//
//   `UserMessageActions` — o `‹ n/N ›` e o botão de editar, na mesma linha do
//   copiar. Os três se revelam juntos no hover da mensagem (spec 130, item 4).
//   A 127 tinha deixado o `‹ n/N ›` sempre visível por ser *estado* e não ação;
//   o owner pediu o contrário — a linha em repouso fica limpa e tudo o que
//   pertence à mensagem aparece de uma vez.
//
//   `MessageEditForm` — o composer aparecendo no lugar da bolha, com o texto
//   atual carregado. Mesma linguagem visual do composer de baixo porque faz o
//   mesmo trabalho.
//
// `t` é injetado em vez de vir de `useI18n()`: sem provider o hook estoura, e
// é isso que permite exercitar estes componentes em `react-test-renderer`
// (mesmo padrão de `TranscriptChatDock`).
// ============================================================================

import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil } from '@/components/ui/icons';
import type { TranslateFn } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import {
  hasMessageVersions,
  versionNeighborId,
  type MessageVersions,
} from '../../lib/chat-versions';

/** Base da linha de ações — espelha o botão de copiar da mesma linha. */
const ACTION_BASE =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-opacity';
/** Revelação no hover, igual ao copiar: em telas sem hover fica semivisível. */
const ACTION_REVEAL =
  'opacity-70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100';

/**
 * Cor por estado em vez de `opacity`: a revelação no hover já ocupa a
 * `opacity`, e um `disabled:opacity-*` perderia para o `md:group-hover:` na
 * ordem de variantes do Tailwind — o botão inerte voltaria a parecer ativo
 * justamente quando o cursor está em cima dele.
 */
function stateClass(disabled: boolean): string {
  return disabled
    ? 'cursor-not-allowed text-[var(--color-app-border-strong)]'
    : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)]';
}

/**
 * `‹ 2/3 ›` do ponto de ramificação. Nada é renderizado fora de um ponto de
 * ramificação — conversa sem versão nenhuma segue exatamente como era.
 */
function MessageVersionNav({
  versions,
  disabled,
  onNavigate,
  t,
}: {
  versions: MessageVersions | null | undefined;
  disabled: boolean;
  onNavigate: (messageId: string) => void;
  t: TranslateFn;
}): React.ReactElement | null {
  if (!hasMessageVersions(versions)) return null;
  const previousId = versionNeighborId(versions, -1);
  const nextId = versionNeighborId(versions, 1);

  return (
    <div
      role="group"
      aria-label={t('chat.versionOf', { index: versions.index, total: versions.total })}
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] text-[var(--color-app-muted)] transition-opacity',
        // Spec 130 item 4: o owner pediu o indicador revelado junto das demais
        // ações, revogando a decisão da 127 de mantê-lo sempre visível.
        // `ACTION_REVEAL` esconde por opacidade, não por `display`, então as
        // setas continuam na ordem de tabulação — e o
        // `md:group-focus-within:opacity-100` do grupo (a `<article>` da
        // mensagem) as traz de volta assim que uma delas recebe o foco, sem
        // deixar o teclado navegar para um controle invisível.
        ACTION_REVEAL,
      )}
    >
      <button
        type="button"
        onClick={() => {
          // O atributo `disabled` já barra o clique no navegador; o guarda aqui
          // é o que impede um disparo programático de mandar para o servidor
          // uma troca de trilha que ele vai recusar com 409.
          if (disabled || !previousId) return;
          onNavigate(previousId);
        }}
        disabled={disabled || !previousId}
        aria-label={t('chat.versionPrevious')}
        title={t('chat.versionPrevious')}
        className={cn(
          'grid h-6 w-6 place-items-center rounded transition-colors',
          stateClass(disabled || !previousId),
        )}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {/*
        `tabular-nums`: 9/10 não pode empurrar as setas de lugar.
        `h-6` + `leading-none`: sem isso o número herda a entrelinha do bloco e
        cai uns 4px abaixo do centro das setas — no render fica com cara de
        subscrito, não de contador.
      */}
      <span className="inline-flex h-6 items-center tabular-nums leading-none">
        {t('chat.versionPosition', { index: versions.index, total: versions.total })}
      </span>
      <button
        type="button"
        onClick={() => {
          if (disabled || !nextId) return;
          onNavigate(nextId);
        }}
        disabled={disabled || !nextId}
        aria-label={t('chat.versionNext')}
        title={t('chat.versionNext')}
        className={cn(
          'grid h-6 w-6 place-items-center rounded transition-colors',
          stateClass(disabled || !nextId),
        )}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Indicador de versão + botão de editar, para entrar na linha de ações da
 * mensagem do usuário ao lado do copiar.
 *
 * `streaming` e `pending` bloqueiam os dois controles. O servidor já recusa
 * versionar e trocar de trilha durante a geração (409), mas oferecer o botão
 * para depois falhar é pior do que não oferecer. `pending` cobre o outro caso
 * em que não há o que versionar ainda: mensagem ainda não persistida (bolha
 * otimista, id `local-*`) e troca de trilha em voo.
 */
export function UserMessageActions({
  versions,
  streaming,
  pending,
  onEdit,
  onNavigate,
  t,
}: {
  versions: MessageVersions | null | undefined;
  streaming: boolean;
  pending: boolean;
  onEdit: () => void;
  onNavigate: (messageId: string) => void;
  t: TranslateFn;
}): React.ReactElement {
  const disabled = streaming || pending;
  return (
    <>
      <MessageVersionNav versions={versions} disabled={disabled} onNavigate={onNavigate} t={t} />
      <button
        type="button"
        onClick={() => !disabled && onEdit()}
        disabled={disabled}
        aria-label={t('chat.editMessage')}
        title={t('chat.editMessage')}
        className={cn(ACTION_BASE, ACTION_REVEAL, stateClass(disabled))}
      >
        <Pencil className="h-3.5 w-3.5" />
        <span>{t('chat.edit')}</span>
      </button>
    </>
  );
}

/** Teto de altura antes de rolar internamente — o composer usa os mesmos. */
const EDIT_MAX_HEIGHT_PX = 200;
/**
 * ...mas nunca mais que esta fração da viewport, pelo mesmo motivo do composer:
 * num celular com o teclado aberto, 200px fixos engolem quase toda a área útil
 * e escondem a conversa que se está editando.
 */
const EDIT_MAX_HEIGHT_VH = 0.3;

function editMaxHeight(): number {
  const viewport = window.visualViewport?.height ?? window.innerHeight;
  if (!Number.isFinite(viewport) || viewport <= 0) return EDIT_MAX_HEIGHT_PX;
  return Math.min(EDIT_MAX_HEIGHT_PX, viewport * EDIT_MAX_HEIGHT_VH);
}

/**
 * Edição embutida da mensagem do usuário. O rascunho vive AQUI, inicializado
 * com o texto atual: é o critério de aceite "editar abre a mensagem com o
 * texto atual carregado", e mantê-lo no componente evita que a página precise
 * sincronizar rascunho com id em edição.
 *
 * Reenviar sem mudar o texto é uso legítimo (tentar outra resposta), então não
 * há verificação de "mudou" — só de "não está vazio".
 */
export function MessageEditForm({
  initialText,
  disabled,
  onCancel,
  onSubmit,
  t,
}: {
  initialText: string;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (content: string) => void;
  t: TranslateFn;
}): React.ReactElement {
  const [draft, setDraft] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !disabled;

  // Cresce com o conteúdo até o teto. Zerar a altura antes de ler
  // `scrollHeight` é obrigatório, senão o valor fica preso na altura anterior
  // e a caixa nunca encolhe (mesmo motivo do composer).
  //
  // Remedir no resize não é zelo: a largura muda sem o texto mudar (girar o
  // celular, abrir/fechar a sidebar, teclado virtual), o texto passa a ocupar
  // mais linhas e a caixa fica presa na altura antiga, cortando o que se está
  // editando atrás dos botões — reproduzido a 375px depois de abrir a edição
  // numa janela larga.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    function measure(): void {
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, editMaxHeight())}px`;
    }
    measure();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', measure);
    window.addEventListener('resize', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, [draft]);

  // Abre com o cursor no fim do texto: quem edita normalmente quer continuar
  // escrevendo, não sobrescrever o que estava lá.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  function submit(): void {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="w-full max-w-[85%] self-end"
    >
      <div className="flex flex-col gap-1.5 rounded-2xl border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] p-2 transition-colors focus-within:border-[var(--color-accent-primary)]/50">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          aria-label={t('chat.editMessage')}
          style={{
            maxHeight: `min(${EDIT_MAX_HEIGHT_PX}px, ${EDIT_MAX_HEIGHT_VH * 100}dvh)`,
          }}
          className="min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[14.5px] leading-relaxed text-[var(--color-app-fg)] outline-none"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-[var(--color-accent-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('chat.versionResend')}
          </button>
        </div>
      </div>
    </form>
  );
}
