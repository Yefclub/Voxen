import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTranscriptChatMessage } from '../src/client/lib/chat-handoff';

describe('buildTranscriptChatMessage', () => {
  test('prefixes library context with transcript id and title', () => {
    const msg = buildTranscriptChatMessage({
      userText: '  Quais os pontos principais?  ',
      transcriptId: 'tx_1',
      title: 'Video demo',
    });
    expect(msg).toContain('transcriptId=tx_1');
    expect(msg).toContain('Video demo');
    expect(msg).toContain('Quais os pontos principais?');
  });
});

describe('chat handoff wiring', () => {
  test('ChatPage accepts autoSend location state', () => {
    const chat = readFileSync(join(import.meta.dir, '../src/client/pages/chat.tsx'), 'utf8');
    expect(chat).toContain('pendingAutoSendRef');
    expect(chat).toContain('ChatHandoffState');
    // Sem o parêntese de fechamento: o que importa aqui é que `send` aceita o
    // texto do handoff, não a lista completa de parâmetros dela.
    expect(chat).toContain('async function send(override?: string');
    expect(chat).toContain('void send(pending)');
  });

  test('transcript detail has copy summary and chat bar', () => {
    const page = readFileSync(
      join(import.meta.dir, '../src/client/pages/transcricoes-detalhe.tsx'),
      'utf8',
    );
    expect(page).toContain('TranscriptChatDock');
    expect(page).toContain('copySummary');
    expect(page).toContain('buildTranscriptChatMessage');
    expect(page).toContain('library.copySummary');
  });
});
