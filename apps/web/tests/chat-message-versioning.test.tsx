import React from 'react';
import { afterAll, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  MessageEditForm,
  UserMessageActions,
} from '../src/client/components/chat/message-versioning';
import type { MessageVersions } from '../src/client/lib/chat-versions';
import type { TranslateFn } from '../src/client/lib/i18n';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

// Os ícones do app chamam `useReducedMotion`, que lê `matchMedia`. Sem DOM,
// este é o mínimo para renderizá-los (mesmo stub de `transcript-chat-dock`).
const originalWindow = globalThis.window;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { matchMedia: () => ({ matches: false }) },
});

afterAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

/** Interpola como o `t` real, para que o teste veja índice e total no rótulo. */
const translate = ((key: string, vars?: Record<string, string | number>): string =>
  vars
    ? `${key}:${Object.entries(vars)
        .map(([name, value]) => `${name}=${value}`)
        .join(',')}`
    : key) as TranslateFn;

type ButtonProps = {
  disabled?: boolean;
  onClick?: () => void;
  'aria-label'?: string;
};

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

function buttonByLabel(renderer: ReactTestRenderer, label: string): ButtonProps {
  const found = renderer.root
    .findAllByType('button')
    .map((node) => node.props as ButtonProps)
    .find((props) => props['aria-label'] === label);
  if (!found) throw new Error(`Botão não encontrado: ${label}`);
  return found;
}

function textContent(renderer: ReactTestRenderer): string {
  const collect = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(collect).join('');
    if (node && typeof node === 'object' && 'children' in node) {
      const children = (node as { children: unknown }).children;
      return children == null ? '' : collect(children);
    }
    return '';
  };
  return collect(renderer.toJSON());
}

/**
 * Só os campos de dado são sobrescrevíveis: espalhar `Partial<Props>` alargaria
 * `onEdit`/`onNavigate` para a assinatura nua e o teste perderia acesso a
 * `.mock.calls`.
 */
function actionsProps(
  overrides: { versions?: MessageVersions | null; streaming?: boolean; pending?: boolean } = {},
) {
  return {
    versions: { index: 2, total: 3, ids: ['v1', 'v2', 'v3'] } as MessageVersions | null,
    streaming: false,
    pending: false,
    onEdit: mock(() => undefined),
    onNavigate: mock((_id: string) => undefined),
    t: translate,
    ...overrides,
  };
}

describe('UserMessageActions', () => {
  test('exibe o indicador n/N em ponto de ramificação', async () => {
    const renderer = await render(React.createElement(UserMessageActions, actionsProps()));
    expect(textContent(renderer)).toContain('chat.versionPosition:index=2,total=3');
  });

  test('mensagem sem irmã não ganha indicador, só o botão de editar', async () => {
    const renderer = await render(
      React.createElement(UserMessageActions, actionsProps({ versions: null })),
    );
    expect(textContent(renderer)).not.toContain('chat.versionPosition');
    expect(buttonByLabel(renderer, 'chat.editMessage').disabled).toBe(false);
  });

  test('grupo com uma única versão também não exibe indicador', async () => {
    // Não basta testar `null`: um grupo degenerado renderizaria "1/1" com as
    // duas setas mortas, poluindo toda conversa anterior à feature.
    const renderer = await render(
      React.createElement(
        UserMessageActions,
        actionsProps({ versions: { index: 1, total: 1, ids: ['v1'] } }),
      ),
    );
    expect(textContent(renderer)).not.toContain('chat.versionPosition');
  });

  test('as setas ativam a versão irmã correspondente', async () => {
    const props = actionsProps();
    const renderer = await render(React.createElement(UserMessageActions, props));
    await act(async () => {
      buttonByLabel(renderer, 'chat.versionPrevious').onClick?.();
    });
    await act(async () => {
      buttonByLabel(renderer, 'chat.versionNext').onClick?.();
    });
    expect(props.onNavigate.mock.calls).toEqual([['v1'], ['v3']]);
  });

  test('a seta desabilita na ponta da lista de versões', async () => {
    const renderer = await render(
      React.createElement(
        UserMessageActions,
        actionsProps({ versions: { index: 1, total: 2, ids: ['v1', 'v2'] } }),
      ),
    );
    expect(buttonByLabel(renderer, 'chat.versionPrevious').disabled).toBe(true);
    expect(buttonByLabel(renderer, 'chat.versionNext').disabled).toBe(false);
  });

  test('durante a geração, versionar e trocar de trilha ficam bloqueados', async () => {
    const props = actionsProps({ streaming: true });
    const renderer = await render(React.createElement(UserMessageActions, props));
    const edit = buttonByLabel(renderer, 'chat.editMessage');
    const previous = buttonByLabel(renderer, 'chat.versionPrevious');
    const next = buttonByLabel(renderer, 'chat.versionNext');
    expect([edit.disabled, previous.disabled, next.disabled]).toEqual([true, true, true]);

    // O atributo sozinho não basta: um `onClick` que ignore o bloqueio ainda
    // dispararia o pedido que o servidor recusa com 409.
    await act(async () => {
      edit.onClick?.();
      previous.onClick?.();
      next.onClick?.();
    });
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  test('mensagem ainda não persistida também não pode ser versionada', async () => {
    const props = actionsProps({ pending: true });
    const renderer = await render(React.createElement(UserMessageActions, props));
    await act(async () => {
      buttonByLabel(renderer, 'chat.editMessage').onClick?.();
    });
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  test('sem geração em curso, editar abre para quem clicou', async () => {
    const props = actionsProps();
    const renderer = await render(React.createElement(UserMessageActions, props));
    await act(async () => {
      buttonByLabel(renderer, 'chat.editMessage').onClick?.();
    });
    expect(props.onEdit).toHaveBeenCalledTimes(1);
  });
});

function formProps(overrides: { initialText?: string; disabled?: boolean } = {}) {
  return {
    initialText: 'texto original da pergunta',
    disabled: false,
    onCancel: mock(() => undefined),
    onSubmit: mock((_content: string) => undefined),
    t: translate,
    ...overrides,
  };
}

describe('MessageEditForm', () => {
  test('abre com o texto atual da mensagem carregado', async () => {
    const renderer = await render(React.createElement(MessageEditForm, formProps()));
    expect(renderer.root.findByType('textarea').props.value).toBe('texto original da pergunta');
  });

  test('reenvia o texto editado', async () => {
    const props = formProps();
    const renderer = await render(React.createElement(MessageEditForm, props));
    await act(async () => {
      renderer.root.findByType('textarea').props.onChange({ target: { value: '  texto novo  ' } });
    });
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
    });
    expect(props.onSubmit).toHaveBeenCalledWith('texto novo');
  });

  test('reenviar o mesmo texto é permitido — é tentar outra resposta', async () => {
    const props = formProps();
    const renderer = await render(React.createElement(MessageEditForm, props));
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
    });
    expect(props.onSubmit).toHaveBeenCalledWith('texto original da pergunta');
  });

  test('texto vazio não reenvia', async () => {
    const props = formProps();
    const renderer = await render(React.createElement(MessageEditForm, props));
    await act(async () => {
      renderer.root.findByType('textarea').props.onChange({ target: { value: '   ' } });
    });
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('durante a geração o reenvio fica bloqueado', async () => {
    const props = formProps({ disabled: true });
    const renderer = await render(React.createElement(MessageEditForm, props));
    const submit = renderer.root
      .findAllByType('button')
      .find((node) => (node.props as { type?: string }).type === 'submit');
    expect((submit?.props as ButtonProps | undefined)?.disabled).toBe(true);
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('Enter reenvia e Escape fecha sem reenviar', async () => {
    const props = formProps();
    const renderer = await render(React.createElement(MessageEditForm, props));
    const textarea = renderer.root.findByType('textarea');
    await act(async () => {
      textarea.props.onKeyDown({ key: 'Escape', preventDefault: () => undefined });
    });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => undefined });
    });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  test('Shift+Enter quebra linha em vez de reenviar', async () => {
    const props = formProps();
    const renderer = await render(React.createElement(MessageEditForm, props));
    await act(async () => {
      renderer.root
        .findByType('textarea')
        .props.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => undefined });
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('cancelar fecha sem reenviar', async () => {
    const props = formProps();
    const renderer = await render(React.createElement(MessageEditForm, props));
    const cancel = renderer.root
      .findAllByType('button')
      .find((node) => (node.props as { type?: string }).type === 'button');
    await act(async () => {
      (cancel?.props as ButtonProps | undefined)?.onClick?.();
    });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
