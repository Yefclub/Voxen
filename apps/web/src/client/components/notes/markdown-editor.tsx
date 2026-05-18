// ============================================================================
// MarkdownEditor — wrapper de CodeMirror 6 com tema Voxen (zinc + violet)
// ============================================================================
// CodeMirror é o mesmo editor que Obsidian usa por baixo. Syntax highlight de
// markdown (negrito, itálico, headings, listas, code blocks), wiki-links
// [[título]] destacados em violeta, soft-wrap, sem line numbers.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Highlight estilo Voxen — combina com o tema dark zinc + acentos violet/emerald
const voxenHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'text-zinc-100 font-display text-2xl font-bold' },
  { tag: t.heading2, class: 'text-zinc-100 font-display text-xl font-semibold' },
  { tag: t.heading3, class: 'text-zinc-100 font-display text-lg font-semibold' },
  { tag: t.heading4, class: 'text-zinc-200 font-medium' },
  { tag: t.strong, class: 'text-zinc-100 font-semibold' },
  { tag: t.emphasis, class: 'italic text-zinc-200' },
  { tag: t.link, color: 'oklch(72% 0.18 290)', textDecoration: 'underline' },
  { tag: t.url, color: 'oklch(73% 0.16 159)' },
  { tag: t.quote, class: 'text-zinc-400 italic border-l-2 border-zinc-700 pl-3' },
  { tag: t.list, class: 'text-zinc-200' },
  {
    tag: t.monospace,
    color: 'oklch(80% 0.16 78)',
    backgroundColor: 'oklch(28% 0.005 250 / 0.5)',
    class: 'font-mono px-1 rounded',
  },
  { tag: t.processingInstruction, color: 'oklch(68% 0.008 250)' }, // marcadores #, *, [
  { tag: t.contentSeparator, color: 'oklch(34% 0.008 250)' },
  { tag: t.meta, color: 'oklch(68% 0.008 250)' },
]);

// Tema base — zera bordas, fundo transparente (pega do Card), font padrão
const voxenTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'rgb(244 244 245)', // zinc-100
      fontSize: '14.5px',
      lineHeight: '1.7',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'oklch(72% 0.18 290)',
      fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
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
      borderLeftColor: 'oklch(72% 0.18 290)',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'oklch(72% 0.18 290 / 0.25) !important',
    },
    '.cm-scroller': {
      fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
      overflow: 'auto',
    },
    '.cm-gutters': {
      display: 'none', // sem line numbers (Obsidian-like)
    },
  },
  { dark: true },
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
  placeholder = 'Comece a escrever em markdown…',
  readOnly = false,
  autoFocus = false,
}: Props): React.ReactElement {
  const ref = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, addKeymap: true }),
      syntaxHighlighting(voxenHighlight),
      EditorView.lineWrapping,
    ],
    [],
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
      placeholder={placeholder}
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
      theme={voxenTheme}
      height="100%"
      className="h-full"
    />
  );
}
