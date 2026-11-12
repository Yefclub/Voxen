import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-provider';

const voxenHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'text-[var(--color-app-fg)] font-display text-2xl font-bold' },
  { tag: t.heading2, class: 'text-[var(--color-app-fg)] font-display text-xl font-semibold' },
  { tag: t.heading3, class: 'text-[var(--color-app-fg)] font-display text-lg font-semibold' },
  { tag: t.heading4, class: 'text-[var(--color-app-subtle)] font-medium' },
  { tag: t.strong, class: 'text-[var(--color-app-fg)] font-semibold' },
  { tag: t.emphasis, class: 'italic text-[var(--color-app-subtle)]' },
  { tag: t.link, color: 'var(--color-accent-violet)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--color-accent-primary)' },
  {
    tag: t.quote,
    class:
      'text-[var(--color-app-muted)] italic border-l border-[var(--color-app-border-strong)] pl-3',
  },
  { tag: t.list, class: 'text-[var(--color-app-subtle)]' },
  {
    tag: t.monospace,
    color: 'var(--color-accent-amber)',
    backgroundColor: 'var(--color-app-surface)',
    class: 'font-mono px-1 rounded',
  },
  { tag: t.processingInstruction, color: 'var(--color-app-muted)' },
  { tag: t.contentSeparator, color: 'var(--color-app-muted)' },
  { tag: t.meta, color: 'var(--color-app-muted)' },
]);

const createVoxenTheme = (dark: boolean) =>
  EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: 'var(--color-app-fg)',
        fontSize: '16px',
        lineHeight: '1.7',
        height: '100%',
      },
      '.cm-content': {
        caretColor: 'var(--color-accent-violet)',
        fontFamily: 'var(--font-sans)',
        padding: '4px 0',
      },
      '.cm-content[contenteditable="true"]': {
        outline: 'none',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-line': {
        padding: '0',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-accent-violet)',
        borderLeftWidth: '2px',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--theme-selection) !important',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-sans)',
        overflow: 'auto',
      },
      '.cm-gutters': {
        display: 'none',
      },
    },
    { dark },
  );

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  autoFocus = false,
}: Props): React.ReactElement {
  const { t: translate } = useI18n();
  const ref = useRef<ReactCodeMirrorRef>(null);
  const { theme } = useTheme();
  const editorTheme = useMemo(() => createVoxenTheme(theme === 'dark'), [theme]);

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, addKeymap: true }),
      syntaxHighlighting(voxenHighlight),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': translate('design.noteContent') }),
    ],
    [translate],
  );

  useEffect(() => {
    if (autoFocus) {
      ref.current?.view?.focus();
    }
  }, [autoFocus]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? translate('notes.editorPlaceholder')}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLineGutter: false,
        highlightActiveLine: false,
        bracketMatching: true,
        autocompletion: false,
        indentOnInput: true,
        searchKeymap: true,
      }}
      extensions={extensions}
      theme={editorTheme}
      height="100%"
      className="h-full"
    />
  );
}
