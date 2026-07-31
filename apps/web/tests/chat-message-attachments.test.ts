import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_MESSAGE_ATTACHMENTS,
  buildMessageAttachments,
  parseMessageAttachments,
  type MessageAttachment,
} from '../src/lib/chat/message-attachments';

const doc: MessageAttachment = { jobId: 'job-1', name: 'contrato.pdf', kind: 'document' };

describe('parseMessageAttachments', () => {
  test('devolve lista vazia para valores ausentes ou não-array', () => {
    expect(parseMessageAttachments(null)).toEqual([]);
    expect(parseMessageAttachments(undefined)).toEqual([]);
    expect(parseMessageAttachments({ jobId: 'x' })).toEqual([]);
    expect(parseMessageAttachments('[]')).toEqual([]);
  });

  test('mantém apenas entradas com forma válida', () => {
    const parsed = parseMessageAttachments([
      doc,
      { jobId: 'job-2', name: '', kind: 'image' },
      { jobId: 'job-3', name: 'clip.mp4', kind: 'outro' },
      { name: 'sem-id.pdf', kind: 'document' },
      null,
      { jobId: 'job-4', name: 'foto.png', kind: 'image' },
    ]);
    expect(parsed).toEqual([doc, { jobId: 'job-4', name: 'foto.png', kind: 'image' }]);
  });

  test('descarta campos extras vindos do JSONB', () => {
    const parsed = parseMessageAttachments([{ ...doc, malicioso: '<script>' }]);
    expect(parsed).toEqual([doc]);
  });

  test('respeita o teto de anexos por mensagem', () => {
    const many = Array.from({ length: MAX_MESSAGE_ATTACHMENTS + 3 }, (_, index) => ({
      jobId: `job-${index}`,
      name: `arquivo-${index}.pdf`,
      kind: 'document' as const,
    }));
    expect(parseMessageAttachments(many)).toHaveLength(MAX_MESSAGE_ATTACHMENTS);
  });
});

describe('buildMessageAttachments', () => {
  const resolved = [
    { jobId: 'job-b', name: 'b.pdf', kind: 'document' as const },
    { jobId: 'job-a', name: 'a.png', kind: 'image' as const },
  ];

  test('preserva a ordem pedida pelo cliente', () => {
    expect(buildMessageAttachments(['job-a', 'job-b'], resolved)).toEqual([
      { jobId: 'job-a', name: 'a.png', kind: 'image' },
      { jobId: 'job-b', name: 'b.pdf', kind: 'document' },
    ]);
  });

  test('descarta ids que o servidor não resolveu (job de outro usuário ou inexistente)', () => {
    expect(buildMessageAttachments(['job-a', 'job-de-outro'], resolved)).toEqual([
      { jobId: 'job-a', name: 'a.png', kind: 'image' },
    ]);
  });

  test('remove ids repetidos', () => {
    expect(buildMessageAttachments(['job-a', 'job-a'], resolved)).toHaveLength(1);
  });

  test('nunca ultrapassa o teto por mensagem', () => {
    const ids = Array.from({ length: MAX_MESSAGE_ATTACHMENTS + 2 }, (_, i) => `job-${i}`);
    const all = ids.map((jobId) => ({ jobId, name: `${jobId}.pdf`, kind: 'document' as const }));
    expect(buildMessageAttachments(ids, all)).toHaveLength(MAX_MESSAGE_ATTACHMENTS);
  });

  test('devolve lista vazia quando não há pedido', () => {
    expect(buildMessageAttachments([], resolved)).toEqual([]);
  });
});

// ============================================================================
// Contrato de origem — o vínculo precisa nascer no servidor e sobreviver ao
// reload (spec 126). Sem isso, os helpers puros acima não valem nada.
// ============================================================================

function source(relativePath: string): string {
  return readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
}

describe('vínculo do anexo com a mensagem', () => {
  const route = source('src/routes/chat.ts');
  const turnRuntime = source('src/lib/chat/turn-runtime.ts');
  const runtime = source('src/lib/chat/runtime.ts');
  const chat = source('src/client/pages/chat.tsx');
  const schema = readFileSync(join(import.meta.dir, '../../../prisma/schema.prisma'), 'utf8');

  test('o cliente só envia ids de job — nome e tipo vêm do servidor', () => {
    expect(chat).toContain('attachmentJobIds');
    expect(route).toContain('attachmentJobIds: z.array(');
    // O escopo por userId é o que impede um id de outro workspace virar anexo.
    expect(route).toContain('where: { id: { in: [...jobIds] }, userId }');
    expect(route).toContain('parseUploadSourceUrl(job.sourceUrl)');
  });

  test('o anexo é persistido na mensagem do usuário', () => {
    expect(turnRuntime).toContain('attachments: readonly MessageAttachment[]');
    expect(turnRuntime).toContain("role: 'USER'");
    expect(turnRuntime).toContain('attachments: attachments as unknown as Prisma.InputJsonValue');
    expect(schema).toContain('attachments    Json?');
  });

  test('o snapshot devolve os anexos já normalizados', () => {
    expect(runtime).toContain('attachments: true');
    expect(runtime).toContain('parseMessageAttachments(message.attachments)');
  });

  test('a bolha do usuário renderiza os anexos vindos do snapshot', () => {
    expect(chat).toContain('<MessageAttachments attachments={message.attachments} />');
  });
});
