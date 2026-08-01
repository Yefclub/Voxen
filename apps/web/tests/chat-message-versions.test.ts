// ============================================================================
// Fronteira de workspace no versionamento (spec 127)
// ----------------------------------------------------------------------------
// Isolamento por `userId` é regra inegociável (CLAUDE.md § Isolamento de
// Workspaces) e a spec 127 vende a propriedade explicitamente: "versão só pode
// ser criada, lida ou ativada pelo dono da conversa, com o identificador do
// usuário derivado da sessão".
//
// Por isso o teste executa o código em vez de fazer `toContain` no texto-fonte:
// um grep aceita qualquer reescrita que preserve a string (num comentário, por
// exemplo) enquanto a query viva perde o filtro. O finder falso emula o
// Postgres — filtra pelo `where` que RECEBEU. Se o escopo sumir da consulta, a
// mensagem do outro workspace passa a ser devolvida, o versionamento acontece
// nela, e o teste falha pelo RETORNO, não só pela asserção do `where`.
// ============================================================================

import { describe, expect, test } from 'bun:test';
import {
  activateMessageVersion,
  ensureConversationLinearized,
  findOwnedMessage,
  MessageVersionError,
  resolveAppendParent,
  resolveVersionTarget,
  type OwnedMessageFinder,
  type OwnedMessageQuery,
  type OwnedMessageRow,
} from '../src/lib/chat/message-versions';
import type { TrailNodeFinder, TrailNodeRow } from '../src/lib/chat/conversation-trail';

interface StoredMessage extends OwnedMessageRow {
  userId: string;
}

const MESSAGES: StoredMessage[] = [
  { id: 'msg-a', userId: 'user-a', conversationId: 'conv-a', parentId: 'raiz-a', role: 'USER' },
  { id: 'msg-b', userId: 'user-b', conversationId: 'conv-b', parentId: 'raiz-b', role: 'USER' },
  {
    id: 'resposta-a',
    userId: 'user-a',
    conversationId: 'conv-a',
    parentId: 'msg-a',
    role: 'ASSISTANT',
  },
];

function fakeMessageFinder(): { find: OwnedMessageFinder; queries: OwnedMessageQuery[] } {
  const queries: OwnedMessageQuery[] = [];
  const find: OwnedMessageFinder = async (query) => {
    queries.push(query);
    // `Partial` porque o teste precisa observar também a query MUTADA (sem
    // escopo), que é justamente o cenário que ele existe para reprovar.
    const where = query.where as Partial<OwnedMessageQuery['where']>;
    const found = MESSAGES.find(
      (message) =>
        message.id === where.id &&
        (where.conversation === undefined || message.userId === where.conversation.userId),
    );
    if (!found) return null;
    const { userId: _userId, ...row } = found;
    return row;
  };
  return { find, queries };
}

describe('findOwnedMessage — escopo de workspace', () => {
  test('encontra a mensagem do próprio usuário e a query carrega o userId', async () => {
    const { find, queries } = fakeMessageFinder();

    const found = await findOwnedMessage('user-a', 'msg-a', find);

    expect(found?.id).toBe('msg-a');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.where.conversation.userId).toBe('user-a');
  });

  test('mensagem de outro workspace não é encontrada', async () => {
    const { find, queries } = fakeMessageFinder();

    expect(await findOwnedMessage('user-a', 'msg-b', find)).toBeNull();
    expect(queries[0]?.where.conversation.userId).toBe('user-a');
  });
});

describe('resolveVersionTarget', () => {
  test('mensagem de outro workspace não pode ser versionada', async () => {
    const { find } = fakeMessageFinder();

    await expect(resolveVersionTarget('user-a', 'msg-b', find)).rejects.toThrow(
      'Mensagem não encontrada.',
    );
  });

  test('mensagem do assistente está fora de escopo na spec 127', async () => {
    const { find } = fakeMessageFinder();

    const failure = await resolveVersionTarget('user-a', 'resposta-a', find).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(MessageVersionError);
    expect((failure as MessageVersionError).status).toBe(400);
  });

  test('a mensagem do dono devolve o antecessor que a versão nova vai herdar', async () => {
    const { find } = fakeMessageFinder();

    const target = await resolveVersionTarget('user-a', 'msg-a', find);

    // A versão nasce IRMÃ: mesmo antecessor da mensagem editada.
    expect(target.parentId).toBe('raiz-a');
    expect(target.conversationId).toBe('conv-a');
  });
});

function fakeNodeFinder(rows: readonly TrailNodeRow[]): TrailNodeFinder {
  return async (query) => (query.where.conversationId === 'conv-a' ? [...rows] : []);
}

function trailNode(
  id: string,
  parentId: string | null,
  role: TrailNodeRow['role'],
  at: number,
): TrailNodeRow {
  return { id, parentId, role, kind: 'NORMAL', compactedAt: null, createdAt: new Date(at) };
}

describe('activateMessageVersion', () => {
  const NODES = [
    trailNode('raiz-a', null, 'ASSISTANT', 1_000),
    trailNode('msg-a', 'raiz-a', 'USER', 2_000),
    trailNode('resposta-a', 'msg-a', 'ASSISTANT', 3_000),
  ];

  test('ativar versão de outro workspace não escreve nada', async () => {
    const { find } = fakeMessageFinder();
    const writes: Array<{ conversationId: string; activeLeafId: string }> = [];

    await expect(
      activateMessageVersion('user-a', 'msg-b', {
        findMessage: find,
        findNodes: fakeNodeFinder(NODES),
        isThinking: async () => false,
        setActiveLeaf: async (conversationId, activeLeafId) => {
          writes.push({ conversationId, activeLeafId });
        },
      }),
    ).rejects.toThrow('Mensagem não encontrada.');

    expect(writes).toEqual([]);
  });

  test('ativar a própria versão move o ponteiro para a folha daquela trilha', async () => {
    const { find } = fakeMessageFinder();
    const writes: Array<{ conversationId: string; activeLeafId: string }> = [];

    const result = await activateMessageVersion('user-a', 'msg-a', {
      findMessage: find,
      findNodes: fakeNodeFinder(NODES),
      isThinking: async () => false,
      setActiveLeaf: async (conversationId, activeLeafId) => {
        writes.push({ conversationId, activeLeafId });
      },
    });

    expect(result).toEqual({ conversationId: 'conv-a', activeLeafId: 'resposta-a' });
    expect(writes).toEqual([{ conversationId: 'conv-a', activeLeafId: 'resposta-a' }]);
  });

  test('trocar de trilha é bloqueado enquanto uma resposta está sendo gerada', async () => {
    const { find } = fakeMessageFinder();
    const writes: string[] = [];

    const failure = await activateMessageVersion('user-a', 'msg-a', {
      findMessage: find,
      findNodes: fakeNodeFinder(NODES),
      isThinking: async () => true,
      setActiveLeaf: async (_conversationId, activeLeafId) => {
        writes.push(activeLeafId);
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MessageVersionError);
    expect((failure as MessageVersionError).status).toBe(409);
    expect(writes).toEqual([]);
  });
});

describe('ensureConversationLinearized', () => {
  test('encadeia o acervo antigo e devolve a quantidade de passos', async () => {
    const nodes = [
      trailNode('l1', null, 'USER', 1_000),
      trailNode('l2', null, 'ASSISTANT', 2_000),
      trailNode('l3', null, 'USER', 3_000),
    ];
    const applied: Array<{ id: string; parentId: string }> = [];

    const steps = await ensureConversationLinearized('conv-a', nodes, async (id, parentId) => {
      applied.push({ id, parentId });
    });

    expect(steps).toBe(2);
    expect(applied).toEqual([
      { id: 'l2', parentId: 'l1' },
      { id: 'l3', parentId: 'l2' },
    ]);
  });

  test('conversa já encadeada não escreve', async () => {
    const nodes = [trailNode('r1', null, 'USER', 1_000), trailNode('r2', 'r1', 'ASSISTANT', 2_000)];
    let writes = 0;

    expect(
      await ensureConversationLinearized('conv-a', nodes, async () => {
        writes += 1;
      }),
    ).toBe(0);
    expect(writes).toBe(0);
  });
});

describe('resolveAppendParent', () => {
  test('mensagem nova pendura no fim da trilha ativa, não no fim cronológico', () => {
    const trail = [
      trailNode('u1', null, 'USER', 1_000),
      trailNode('a1', 'u1', 'ASSISTANT', 2_000),
      // Versão criada depois, mas que está ACIMA na trilha ativa.
      trailNode('u2', 'a1', 'USER', 9_000),
    ];
    expect(resolveAppendParent(trail)).toBe('u2');
    expect(resolveAppendParent([])).toBeNull();
  });
});
