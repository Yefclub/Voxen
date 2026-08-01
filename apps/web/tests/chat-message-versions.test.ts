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
  resolveTurnParent,
  resolveVersionTarget,
  type LinearizeDeps,
  type OwnedMessageFinder,
  type OwnedMessageQuery,
  type OwnedMessageRow,
} from '../src/lib/chat/message-versions';
import type { TrailNodeFinder, TrailNodeRow } from '../src/lib/chat/conversation-trail';
import { applyLinearization, planLinearization } from '../src/lib/chat/message-trail';

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

function recorder(): {
  deps: LinearizeDeps;
  parents: Array<{ id: string; parentId: string }>;
  marked: number;
} {
  const parents: Array<{ id: string; parentId: string }> = [];
  let marked = 0;
  return {
    parents,
    get marked() {
      return marked;
    },
    deps: {
      updateParent: async (id, parentId) => {
        parents.push({ id, parentId });
      },
      markLinearized: async () => {
        marked += 1;
      },
    },
  };
}

describe('activateMessageVersion', () => {
  const NODES = [
    trailNode('raiz-a', null, 'ASSISTANT', 1_000),
    trailNode('msg-a', 'raiz-a', 'USER', 2_000),
    trailNode('resposta-a', 'msg-a', 'ASSISTANT', 3_000),
  ];

  /** Conversa do acervo antigo: nenhuma mensagem tem antecessor registrado. */
  const LEGACY_NODES = [
    trailNode('l1', null, 'USER', 1_000),
    trailNode('l2', null, 'ASSISTANT', 2_000),
    trailNode('l3', null, 'USER', 3_000),
    trailNode('l4', null, 'ASSISTANT', 4_000),
  ];

  test('ativar versão de outro workspace não escreve nada', async () => {
    const { find } = fakeMessageFinder();
    const claims: Array<{ conversationId: string; activeLeafId: string }> = [];

    await expect(
      activateMessageVersion('user-a', 'msg-b', {
        findMessage: find,
        findNodes: fakeNodeFinder(NODES),
        readState: async () => ({ messagesLinearized: true }),
        linearize: recorder().deps,
        claimActiveLeaf: async (conversationId, activeLeafId) => {
          claims.push({ conversationId, activeLeafId });
          return true;
        },
      }),
    ).rejects.toThrow('Mensagem não encontrada.');

    expect(claims).toEqual([]);
  });

  test('ativar a própria versão move o ponteiro para a folha daquela trilha', async () => {
    const { find } = fakeMessageFinder();
    const claims: Array<{ conversationId: string; activeLeafId: string }> = [];

    const result = await activateMessageVersion('user-a', 'msg-a', {
      findMessage: find,
      findNodes: fakeNodeFinder(NODES),
      readState: async () => ({ messagesLinearized: true }),
      linearize: recorder().deps,
      claimActiveLeaf: async (conversationId, activeLeafId) => {
        claims.push({ conversationId, activeLeafId });
        return true;
      },
    });

    expect(result).toEqual({ conversationId: 'conv-a', activeLeafId: 'resposta-a' });
    expect(claims).toEqual([{ conversationId: 'conv-a', activeLeafId: 'resposta-a' }]);
  });

  test('em conversa antiga, ativar encadeia antes e não trunca a trilha', async () => {
    // Regressão: sem encadear, `resolveDeepestLeaf` não achava filho nenhum,
    // a folha resolvida virava a própria mensagem, e a conversa perdia de
    // forma PERSISTIDA tudo que veio depois dela.
    const { find } = fakeMessageFinder();
    const linearize = recorder();
    const claims: string[] = [];

    const result = await activateMessageVersion('user-a', 'msg-a', {
      findMessage: find,
      findNodes: async (query) =>
        query.where.conversationId === 'conv-a'
          ? [...LEGACY_NODES, trailNode('msg-a', null, 'USER', 5_000)]
          : [],
      readState: async () => ({ messagesLinearized: false }),
      linearize: linearize.deps,
      claimActiveLeaf: async (_conversationId, activeLeafId) => {
        claims.push(activeLeafId);
        return true;
      },
    });

    expect(linearize.parents).toEqual([
      { id: 'l2', parentId: 'l1' },
      { id: 'l3', parentId: 'l2' },
      { id: 'l4', parentId: 'l3' },
      { id: 'msg-a', parentId: 'l4' },
    ]);
    expect(linearize.marked).toBe(1);
    // `msg-a` é a última da cadeia encadeada, então é ela mesma a folha.
    expect(result.activeLeafId).toBe('msg-a');
    expect(claims).toEqual(['msg-a']);
  });

  test('trocar de trilha é bloqueado enquanto uma resposta está sendo gerada', async () => {
    // O bloqueio é a PRÓPRIA escrita condicional: ler `thinking` e gravar em
    // duas idas ao banco deixaria um turno reivindicar no intervalo e montar
    // o prompt do ramo errado.
    const { find } = fakeMessageFinder();

    const failure = await activateMessageVersion('user-a', 'msg-a', {
      findMessage: find,
      findNodes: fakeNodeFinder(NODES),
      readState: async () => ({ messagesLinearized: true }),
      linearize: recorder().deps,
      claimActiveLeaf: async () => false,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MessageVersionError);
    expect((failure as MessageVersionError).status).toBe(409);
  });
});

describe('ensureConversationLinearized', () => {
  test('encadeia o acervo antigo, marca a conversa e devolve os nós corrigidos', async () => {
    const nodes = [
      trailNode('l1', null, 'USER', 1_000),
      trailNode('l2', null, 'ASSISTANT', 2_000),
      trailNode('l3', null, 'USER', 3_000),
    ];
    const linearize = recorder();

    const result = await ensureConversationLinearized(nodes, false, linearize.deps);

    expect(linearize.parents).toEqual([
      { id: 'l2', parentId: 'l1' },
      { id: 'l3', parentId: 'l2' },
    ]);
    expect(linearize.marked).toBe(1);
    // Os nós voltam já corrigidos: a mesma transação segue sem reconsultar.
    expect(result.map((item) => item.parentId)).toEqual([null, 'l1', 'l2']);
  });

  test('conversa nova é marcada mesmo sem nada a encadear', async () => {
    // Sem a marca, a leitura continuaria aplicando a regra de acervo antigo e
    // a raiz nunca poderia ter indicador de versão.
    const nodes = [trailNode('r1', null, 'USER', 1_000), trailNode('r2', 'r1', 'ASSISTANT', 2_000)];
    const linearize = recorder();

    await ensureConversationLinearized(nodes, false, linearize.deps);

    expect(linearize.parents).toEqual([]);
    expect(linearize.marked).toBe(1);
  });

  test('conversa já marcada não escreve nada', async () => {
    const nodes = [trailNode('r1', null, 'USER', 1_000), trailNode('r2', 'r1', 'ASSISTANT', 2_000)];
    const linearize = recorder();

    await ensureConversationLinearized(nodes, true, linearize.deps);

    expect(linearize.parents).toEqual([]);
    expect(linearize.marked).toBe(0);
  });
});

describe('resolveTurnParent', () => {
  const LEGACY = [
    trailNode('l1', null, 'USER', 1_000),
    trailNode('l2', null, 'ASSISTANT', 2_000),
    trailNode('l3', null, 'USER', 3_000),
    trailNode('l4', null, 'ASSISTANT', 4_000),
  ];

  test('versionar usa a lista JÁ encadeada, não a que veio do banco', () => {
    // Regressão do achado 2: com a lista crua de uma conversa antiga, todo
    // antecessor é nulo e a versão nasceria como segunda raiz, jogando fora
    // o histórico anterior a ela.
    const cru = resolveTurnParent(LEGACY, LEGACY, { messageId: 'l3' });
    expect(cru).toEqual({ ok: true, parentId: null });

    const encadeado = applyLinearization(LEGACY, planLinearization(LEGACY));
    expect(resolveTurnParent(encadeado, encadeado, { messageId: 'l3' })).toEqual({
      ok: true,
      parentId: 'l2',
    });
  });

  test('turno normal anexa no fim da trilha, ignorando a lista de nós', () => {
    const trail = [LEGACY[0], LEGACY[1]].filter((item) => item !== undefined);
    expect(resolveTurnParent(LEGACY, trail, undefined)).toEqual({ ok: true, parentId: 'l2' });
    expect(resolveTurnParent(LEGACY, [], undefined)).toEqual({ ok: true, parentId: null });
  });

  test('mensagem de fora da conversa não vira ponto de ramificação', () => {
    expect(resolveTurnParent(LEGACY, LEGACY, { messageId: 'de-outra-conversa' })).toEqual({
      ok: false,
    });
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
