import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { citationsFromToolEvents } from '../src/lib/chat/citations';
import { db } from '../src/lib/db';
import { parseChatCitations } from '../src/shared/chat-citations';

describe('chat citation JSON boundary', () => {
  it('descarta JSONB malformado sem quebrar a mensagem antiga', () => {
    expect(parseChatCitations({ nope: true })).toBeNull();
    expect(parseChatCitations([{ sourceType: 'TRANSCRIPT', sourceId: 3 }])).toEqual([]);
  });
});

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('structured chat citations', () => {
  let ownerId = '';
  let otherId = '';
  let transcriptId = '';
  let otherTranscriptId = '';

  beforeAll(async () => {
    const suffix = Date.now();
    const [owner, other] = await Promise.all([
      db.user.create({
        data: { email: `cit-owner-${suffix}@voxen.local`, name: 'Owner', status: 'APPROVED' },
      }),
      db.user.create({
        data: { email: `cit-other-${suffix}@voxen.local`, name: 'Other', status: 'APPROVED' },
      }),
    ]);
    ownerId = owner.id;
    otherId = other.id;
    const [owned, foreign] = await Promise.all([
      db.transcript.create({
        data: {
          userId: ownerId,
          source: 'WEB',
          url: `https://example.com/citation-${suffix}`,
          title: 'Fonte da citação',
          durationSec: 12,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${ownerId}/citation.md`,
          plainText: 'Trecho verificável',
          frontmatter: {},
        },
      }),
      db.transcript.create({
        data: {
          userId: otherId,
          source: 'WEB',
          url: `https://example.com/foreign-${suffix}`,
          title: 'Fonte alheia',
          durationSec: 12,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${otherId}/foreign.md`,
          plainText: 'Segredo alheio',
          frontmatter: {},
        },
      }),
    ]);
    transcriptId = owned.id;
    otherTranscriptId = foreign.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('persiste apenas fonte do dono, URL navegável e estado de validação', async () => {
    const citations = await citationsFromToolEvents(ownerId, [
      {
        id: 'verify-1',
        name: 'verify_citations',
        state: 'completed',
        input: {
          claims: [
            { transcriptId, quote: 'Trecho verificável', fromLine: 7, toLine: 8, fromSec: 42 },
            { transcriptId, quote: 'Quote sem suporte', fromLine: 9 },
            { transcriptId: otherTranscriptId, quote: 'Segredo alheio', fromLine: 1 },
          ],
        },
        output: {
          results: [
            {
              transcriptId,
              supported: true,
              foundText: 'Trecho verificável',
              region: { from: 7, to: 8 },
            },
            {
              transcriptId,
              supported: false,
              foundText: 'Outro trecho',
              region: { from: 9, to: 9 },
            },
            {
              transcriptId: otherTranscriptId,
              supported: true,
              foundText: 'Segredo alheio',
              region: { from: 1, to: 1 },
            },
          ],
        },
      },
    ]);
    expect(citations).toEqual([
      expect.objectContaining({
        sourceId: transcriptId,
        title: 'Fonte da citação',
        verified: true,
        kind: 'EVIDENCE',
        inlineOrdinal: 1,
        href: `/transcricoes/${transcriptId}#t=42`,
        fromLine: 7,
        toLine: 8,
      }),
      expect.objectContaining({
        quote: 'Quote sem suporte',
        verified: false,
        kind: 'NO_EVIDENCE',
        inlineOrdinal: null,
      }),
    ]);
  });

  it('prioriza uma evidência revalidada na verificação final para citação inline', async () => {
    const claim = { transcriptId, quote: 'Trecho verificável', fromLine: 7 };
    const citations = await citationsFromToolEvents(ownerId, [
      {
        id: 'verify-earlier',
        name: 'verify_citations',
        state: 'completed',
        input: { claims: [claim] },
        output: { results: [{ transcriptId, supported: true, region: { from: 7, to: 7 } }] },
      },
      {
        id: 'verify-final',
        name: 'verify_citations',
        state: 'completed',
        input: { claims: [claim] },
        output: { results: [{ transcriptId, supported: true, region: { from: 7, to: 7 } }] },
      },
    ]);

    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual(expect.objectContaining({ inlineOrdinal: 1, verified: true }));
  });
});
