import { describe, expect, test } from 'bun:test';
import {
  buildTagsRequestBody,
  pickFolderId,
  resolveTagsDecision,
  slugifyTag,
} from '../src/lib/tags-generate';

describe('slugifyTag', () => {
  test('lowercases and strips accents', () => {
    expect(slugifyTag('Anime')).toBe('anime');
    expect(slugifyTag('Estúdio Ghibli')).toBe('estudio-ghibli');
    expect(slugifyTag('Programação')).toBe('programacao');
  });

  test('collapses non-alphanumeric into single hyphen and trims', () => {
    expect(slugifyTag('  Web  Security!! ')).toBe('web-security');
    expect(slugifyTag('C++ / Rust')).toBe('c-rust');
    expect(slugifyTag('---')).toBe('');
  });

  test('same slug for casing/accent variants (dedup key)', () => {
    expect(slugifyTag('anime')).toBe(slugifyTag('Anime'));
    expect(slugifyTag('São Paulo')).toBe(slugifyTag('sao paulo'));
  });
});

describe('resolveTagsDecision', () => {
  test('parses a JSON array of tags', () => {
    expect(resolveTagsDecision('["Anime","Review"]', [])).toEqual(['Anime', 'Review']);
  });

  test('parses fenced JSON and object shapes', () => {
    expect(resolveTagsDecision('```json\n["Elden Ring","RPG"]\n```', [])).toEqual([
      'Elden Ring',
      'RPG',
    ]);
    expect(resolveTagsDecision('{"tags":["TypeScript","Bun"]}', [])).toEqual(['TypeScript', 'Bun']);
  });

  test('falls back to lines / commas', () => {
    expect(resolveTagsDecision('- Anime\n- Review', [])).toEqual(['Anime', 'Review']);
    expect(resolveTagsDecision('Anime, Review, Estúdio Ghibli', [])).toEqual([
      'Anime',
      'Review',
      'Estúdio Ghibli',
    ]);
  });

  test('dedups by slug (casing/accent) keeping first', () => {
    expect(resolveTagsDecision('["Anime","anime","ANIME"]', [])).toEqual(['Anime']);
  });

  test('reuses existing tag name (casing) when slug matches', () => {
    expect(resolveTagsDecision('["anime","review"]', ['Anime', 'Review'])).toEqual([
      'Anime',
      'Review',
    ]);
  });

  test('caps at 5 tags', () => {
    expect(resolveTagsDecision('["a1","b2","c3","d4","e5","f6","g7"]', [])).toHaveLength(5);
  });

  test('drops sentences / reasoning / generic labels', () => {
    expect(resolveTagsDecision('["The content is about anime","Anime"]', [])).toEqual(['Anime']);
    expect(resolveTagsDecision('["Looking at the content","Docker"]', [])).toEqual(['Docker']);
    expect(resolveTagsDecision('["Its about driver.js library","API"]', [])).toEqual(['API']);
    expect(resolveTagsDecision('["conteúdo","misc","various","Anime"]', [])).toEqual(['Anime']);
    expect(
      resolveTagsDecision('["a really long tag with too many words here","OK Tag"]', []),
    ).toEqual(['OK Tag']);
  });

  test('empty / noise yields empty list', () => {
    expect(resolveTagsDecision('', [])).toEqual([]);
    expect(resolveTagsDecision('none', [])).toEqual([]);
  });
});

describe('pickFolderId (regra de folderId único, R-FOLDER)', () => {
  test('keeps current folder when already set', () => {
    expect(pickFolderId('folder-1', 'tag-folder-2')).toBe('folder-1');
  });

  test('adopts candidate folder only when empty', () => {
    expect(pickFolderId(null, 'tag-folder-2')).toBe('tag-folder-2');
  });

  test('stays null when neither is set', () => {
    expect(pickFolderId(null, null)).toBeNull();
  });
});

describe('buildTagsRequestBody', () => {
  test('espelha o contrato estruturado e o orçamento do worker', () => {
    const payload = buildTagsRequestBody('x-ai/grok-4.5', 'system prompt', 'user prompt');

    expect(payload).toEqual({
      model: 'x-ai/grok-4.5',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      temperature: 0.2,
      max_tokens: 256,
      reasoning: { enabled: false },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'content_tags',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              tags: {
                type: 'array',
                items: { type: 'string', minLength: 2, maxLength: 40 },
                minItems: 1,
                maxItems: 5,
              },
            },
            required: ['tags'],
            additionalProperties: false,
          },
        },
      },
      usage: { include: true },
    });
  });
});
