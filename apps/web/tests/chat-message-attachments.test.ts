import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_MESSAGE_ATTACHMENTS,
  buildMessageAttachments,
  parseMessageAttachments,
  type MessageAttachment,
} from '../src/lib/chat/message-attachments';
import {
  resolveAttachments,
  type AttachmentJobFinder,
  type AttachmentJobQuery,
} from '../src/lib/chat/attachment-resolver';
import { CHAT_UPLOAD_ACCEPT, attachmentKind } from '../src/client/lib/chat-tools';
import { detectUploadKind } from '../src/lib/media-upload';

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
// Fronteira de workspace — teste de COMPORTAMENTO (spec 126)
// ----------------------------------------------------------------------------
// Isolamento por `userId` é regra inegociável (CLAUDE.md § Isolamento de
// Workspaces) e a spec 126 vende essa propriedade explicitamente, então ela
// precisa de teste que execute o código, não de `toContain` no texto-fonte:
// um grep aceita qualquer reescrita que preserve a string (num comentário,
// por exemplo) enquanto a query viva perde o filtro.
//
// O finder falso emula o Postgres: filtra pelo `where` que RECEBEU. Se o
// escopo sumir da query, o job do outro workspace passa a ser devolvido e
// vira anexo — e o teste falha pelo retorno, não só pela asserção do `where`.
// ============================================================================

const JOBS = [
  {
    id: 'job-a',
    userId: 'user-a',
    sourceUrl: `upload://${'a'.repeat(8)}-0000-4000-8000-000000000001/foto.png`,
  },
  {
    id: 'job-b',
    userId: 'user-b',
    sourceUrl: `upload://${'b'.repeat(8)}-0000-4000-8000-000000000002/segredo.pdf`,
  },
];

function fakeJobFinder(): { find: AttachmentJobFinder; queries: AttachmentJobQuery[] } {
  const queries: AttachmentJobQuery[] = [];
  const find: AttachmentJobFinder = async (query) => {
    queries.push(query);
    // `Partial` porque o teste precisa observar também a query MUTADA (sem
    // escopo), que é justamente o cenário que ele existe para reprovar.
    const where = query.where as Partial<AttachmentJobQuery['where']>;
    return JOBS.filter(
      (job) =>
        (where.id?.in.includes(job.id) ?? false) &&
        (where.userId === undefined || job.userId === where.userId),
    ).map((job) => ({ id: job.id, sourceUrl: job.sourceUrl }));
  };
  return { find, queries };
}

describe('resolveAttachments — escopo de workspace', () => {
  test('resolve o anexo do próprio usuário', async () => {
    const { find } = fakeJobFinder();
    expect(await resolveAttachments('user-a', ['job-a'], find)).toEqual([
      { jobId: 'job-a', name: 'foto.png', kind: 'image' },
    ]);
  });

  test('job de outro workspace não vira anexo e a query carrega o userId', async () => {
    const { find, queries } = fakeJobFinder();

    const resolved = await resolveAttachments('user-a', ['job-b'], find);

    expect(resolved).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.where.userId).toBe('user-a');
  });

  test('numa lista mista, só o job do próprio usuário sobrevive', async () => {
    const { find } = fakeJobFinder();
    expect(await resolveAttachments('user-a', ['job-b', 'job-a'], find)).toEqual([
      { jobId: 'job-a', name: 'foto.png', kind: 'image' },
    ]);
  });

  test('não consulta o banco quando não há id pedido', async () => {
    const { find, queries } = fakeJobFinder();
    expect(await resolveAttachments('user-a', undefined, find)).toEqual([]);
    expect(await resolveAttachments('user-a', [], find)).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

// ============================================================================
// Cliente e servidor precisam concordar sobre o `kind` (spec 126)
// ----------------------------------------------------------------------------
// `attachmentKind` (cliente, chip otimista) e `detectUploadKind` (servidor,
// forma canônica do snapshot) são DUAS tabelas de extensão. Se divergirem, o
// chip troca de ícone sozinho quando o snapshot chega. Enquanto forem
// duplicadas, este teste é o que segura o par.
// ============================================================================

describe('attachmentKind (cliente) × detectUploadKind (servidor)', () => {
  const extensions = CHAT_UPLOAD_ACCEPT.split(',')
    .filter((item) => item.startsWith('.'))
    .map((item) => item.slice(1));

  test('o catálogo do input não está vazio', () => {
    expect(extensions.length).toBeGreaterThan(20);
  });

  test('concordam em toda extensão aceita pelo input', () => {
    const divergent = extensions.filter(
      (ext) => attachmentKind(`arquivo.${ext}`, '') !== detectUploadKind(`arquivo.${ext}`, ''),
    );
    expect(divergent).toEqual([]);
  });

  test('concordam nos MIME types e nos casos não suportados', () => {
    const cases: Array<[string, string]> = [
      ['foto', 'image/png'],
      ['audio', 'audio/mpeg'],
      ['video', 'video/mp4'],
      ['doc', 'application/pdf'],
      ['planilha', 'text/csv; charset=utf-8'],
      ['binario.exe', ''],
      ['sem-extensao', ''],
      ['arquivo.zip', 'application/zip'],
    ];
    for (const [name, type] of cases) {
      expect([name, attachmentKind(name, type)]).toEqual([name, detectUploadKind(name, type)]);
    }
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
