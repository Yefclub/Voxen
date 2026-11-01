import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db } from '../src/lib/db';
import { searchKnowledgeBase } from '../src/lib/search';
import { transcriptMarkdownToPlainText } from '../src/lib/transcript-corrections';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describe('heading text survives plain-text extraction', () => {
  it('strips markers but keeps heading words', () => {
    const plain = transcriptMarkdownToPlainText('# Caldeira Turbo\n\nCorpo genérico.');
    expect(plain).not.toContain('#');
    expect(plain).toContain('Caldeira Turbo');
  });
});

// Structural recall (spec 217 §5): heading-only terms are retrievable through
// the real write path (plainText keeps heading words at body weight), so no
// schema change is needed for recall. A title-like A-boost for headings stays
// explicitly deferred pending a measured benefit.
describeIfDb('heading recall contract (spec 217 §5)', () => {
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `heading-${Date.now()}@voxen.local`, name: 'Heading', status: 'APPROVED' },
    });
    userId = user.id;
    const md = '# Válvula hiperbárica\n\nProcedimentos genéricos de operação.';
    await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/valvula',
        title: 'Manual genérico',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/valvula.md`,
        plainText: transcriptMarkdownToPlainText(md).slice(0, 20000),
        frontmatter: {},
      },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('retrieves a heading-only term absent from title and body', async () => {
    const results = await searchKnowledgeBase(userId, 'hiperbárica', 8);
    expect(results.map((item) => item.id)).toHaveLength(1);
    expect(results[0]?.title).toBe('Manual genérico');
  });
});
