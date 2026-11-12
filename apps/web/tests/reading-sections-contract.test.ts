import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const DETAIL_SOURCE = readFileSync(
  new URL('../src/client/pages/transcricoes-detalhe.tsx', import.meta.url),
  'utf8',
);
const NOTES_CARD_SOURCE = readFileSync(
  new URL('../src/client/components/library/linked-notes-card.tsx', import.meta.url),
  'utf8',
);

describe('open reading sections (spec 219)', () => {
  test('prepared content renders on an open surface without a card wrapper', () => {
    expect(DETAIL_SOURCE).toContain('<div className="min-w-0 max-w-[75ch]">');
    expect(DETAIL_SOURCE).toMatch(/<Markdown\b[^>]*>\s*\{contentMarkdown\}\s*<\/Markdown>/u);
    expect(DETAIL_SOURCE).not.toContain('<CardContent className="px-5 py-5 sm:px-6">');
  });

  test('local graph remounts per transcript and annotations open the composer', () => {
    expect(DETAIL_SOURCE).toContain('<TranscriptKnowledgeGraph key={t.id} transcriptId={t.id} />');
    expect(DETAIL_SOURCE).toContain(
      'const [linkedNotesOpen, setLinkedNotesOpen] = useState(false)',
    );
    expect(DETAIL_SOURCE).toContain('setLinkedNotesOpen(false)');
    expect(DETAIL_SOURCE).toContain('setLinkedNotesOpen(true)');
    expect(DETAIL_SOURCE).toContain('composerOpen={linkedNotesOpen}');
    expect(DETAIL_SOURCE).toContain('onComposerOpenChange={setLinkedNotesOpen}');
  });

  test('note composer hides without unmounting so the draft is preserved', () => {
    expect(NOTES_CARD_SOURCE).toContain('aria-expanded={composerOpen}');
    expect(NOTES_CARD_SOURCE).toContain('aria-controls="linked-note-composer"');
    expect(NOTES_CARD_SOURCE).toContain(
      '<div id="linked-note-composer" hidden={!composerOpen} className="space-y-2">',
    );
    expect(NOTES_CARD_SOURCE).toContain("t(composerOpen ? 'common.close' : 'shell.newNote')");
    expect(NOTES_CARD_SOURCE).toContain(
      '<div className="max-h-80 space-y-2 overflow-y-auto overscroll-contain">',
    );
  });
});
