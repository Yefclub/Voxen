import React from 'react';
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TranscriptChatDock } from '../src/client/components/library/transcript-chat-dock';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalWindow = globalThis.window;
let hasHover = false;
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    matchMedia: () => ({ matches: hasHover }),
  },
});

beforeEach(() => {
  hasHover = false;
});

afterAll(() => {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

const translate = (key: string, vars?: Record<string, string | number>): string =>
  vars?.title ? `${key}:${vars.title}` : key;

function renderDock(value = '', onSend = mock(() => undefined)): React.ReactElement {
  return React.createElement(TranscriptChatDock, {
    value,
    onChange: mock(() => undefined),
    onSend,
    title: 'Conteúdo de teste',
    t: translate,
  });
}

describe('TranscriptChatDock', () => {
  test('starts collapsed with an accessible 32px peek trigger', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderDock(), {
        createNodeMock: (element) =>
          element.type === 'textarea' ? { style: {}, scrollHeight: 36 } : null,
      });
    });

    const shell = renderer.root.findByProps({ 'data-testid': 'transcript-chat-dock' });
    const trigger = renderer.root.findByProps({
      'data-testid': 'transcript-chat-dock-trigger',
    });
    const content = renderer.root.findByProps({
      'data-testid': 'transcript-chat-dock-content',
    });

    expect(shell.props.style.transform).toBe('translateY(calc(100% - 2rem))');
    expect(trigger.props['aria-expanded']).toBe(false);
    expect(trigger.props['aria-controls']).toBe(content.props.id);
    expect(content.props.inert).toBe(true);
  });

  test('expands on hover or focus and keeps a non-empty draft open', async () => {
    hasHover = true;
    const focusTextarea = mock(() => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderDock(), {
        createNodeMock: (element) =>
          element.type === 'textarea'
            ? { style: {}, scrollHeight: 36, focus: focusTextarea }
            : null,
      });
    });

    const shell = () => renderer.root.findByProps({ 'data-testid': 'transcript-chat-dock' });
    await act(async () => shell().props.onPointerEnter({ pointerType: 'mouse' }));
    expect(shell().props.style.transform).toBe('translateY(0)');

    await act(async () => shell().props.onPointerLeave({ pointerType: 'mouse' }));
    expect(shell().props.style.transform).toBe('translateY(calc(100% - 2rem))');

    const trigger = renderer.root.findByProps({
      'data-testid': 'transcript-chat-dock-trigger',
    });
    await act(async () => trigger.props.onClick({ detail: 1, currentTarget: { blur() {} } }));
    expect(shell().props.style.transform).toBe('translateY(0)');
    expect(focusTextarea).toHaveBeenCalledTimes(1);

    await act(async () => shell().props.onFocusCapture());
    expect(shell().props.style.transform).toBe('translateY(0)');

    await act(async () => renderer.update(renderDock('rascunho')));
    await act(async () =>
      shell().props.onBlurCapture({ currentTarget: { contains: () => false } }),
    );
    await act(async () => shell().props.onPointerLeave({ pointerType: 'mouse' }));
    expect(shell().props.style.transform).toBe('translateY(0)');
  });

  test('toggles from the peek strip on no-hover devices when the draft is empty', async () => {
    const blurTrigger = mock(() => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderDock(), {
        createNodeMock: (element) =>
          element.type === 'textarea'
            ? { style: {}, scrollHeight: 36, focus: mock(() => undefined) }
            : null,
      });
    });

    const shell = () => renderer.root.findByProps({ 'data-testid': 'transcript-chat-dock' });
    const trigger = () =>
      renderer.root.findByProps({ 'data-testid': 'transcript-chat-dock-trigger' });
    const pointerClick = { detail: 1, currentTarget: { blur: blurTrigger } };

    await act(async () => trigger().props.onPointerDown());
    await act(async () => shell().props.onFocusCapture());
    await act(async () => shell().props.onPointerEnter({ pointerType: 'touch' }));
    await act(async () => shell().props.onPointerEnter({ pointerType: 'pen' }));
    await act(async () => trigger().props.onClick(pointerClick));
    expect(shell().props.style.transform).toBe('translateY(0)');

    await act(async () => trigger().props.onPointerDown());
    await act(async () => shell().props.onFocusCapture());
    await act(async () => shell().props.onPointerEnter({ pointerType: 'touch' }));
    await act(async () => trigger().props.onClick(pointerClick));
    expect(shell().props.style.transform).toBe('translateY(calc(100% - 2rem))');
    expect(blurTrigger).toHaveBeenCalledTimes(1);

    await act(async () => renderer.update(renderDock('rascunho')));
    await act(async () => trigger().props.onClick(pointerClick));
    await act(async () => trigger().props.onClick(pointerClick));
    expect(shell().props.style.transform).toBe('translateY(0)');
  });

  test('keeps Enter-to-send and Shift+Enter multiline behavior', async () => {
    const onSend = mock(() => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderDock('pergunta', onSend), {
        createNodeMock: (element) =>
          element.type === 'textarea' ? { style: {}, scrollHeight: 36 } : null,
      });
    });

    const textarea = renderer.root.findByType('textarea');
    const preventDefault = mock(() => undefined);
    await act(async () =>
      textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault }),
    );
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () =>
      textarea.props.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault }),
    );
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
