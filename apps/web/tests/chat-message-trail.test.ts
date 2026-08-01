// ============================================================================
// Trilha ativa da conversa (spec 127)
// ----------------------------------------------------------------------------
// O critério de aceite central da spec — "o histórico enviado ao modelo contém
// apenas a trilha ativa" — é explicitamente marcado como "verificado por teste,
// não por inspeção visual". Por isso aqui não há `toContain` em texto-fonte:
// os testes EXECUTAM `loadActiveHistory`, que é o único caminho pelo qual
// `streamAssistantReply` monta o prompt, com finders que emulam o Postgres.
// Se a resolução da trilha regredir, o vazamento aparece no retorno.
// ============================================================================

import { describe, expect, test } from 'bun:test';
import {
  activeTrailIds,
  loadActiveHistory,
  loadConversationTrail,
  orderByTrail,
  type HistoryFinder,
  type HistoryQuery,
  type HistoryRow,
  type TrailNodeFinder,
  type TrailNodeQuery,
  type TrailNodeRow,
} from '../src/lib/chat/conversation-trail';
import {
  buildVersionGroups,
  isLinearized,
  planLinearization,
  resolveActiveTrail,
  resolveDeepestLeaf,
} from '../src/lib/chat/message-trail';

const CONVERSATION = 'conv-1';
let clock = 0;

function node(
  id: string,
  role: TrailNodeRow['role'],
  parentId: string | null,
  extra: Partial<TrailNodeRow> = {},
): TrailNodeRow {
  clock += 1_000;
  return {
    id,
    role,
    parentId,
    kind: 'NORMAL',
    compactedAt: null,
    createdAt: new Date(clock),
    ...extra,
  };
}

/**
 * Árvore com um ponto de ramificação:
 *
 *   u1 → a1 ┬ u2a → a2a      (trilha antiga)
 *           └ u2b → a2b      (versão nova, trilha ativa)
 */
function branchedTree(): TrailNodeRow[] {
  clock = 0;
  return [
    node('u1', 'USER', null),
    node('a1', 'ASSISTANT', 'u1'),
    node('u2a', 'USER', 'a1'),
    node('a2a', 'ASSISTANT', 'u2a'),
    node('u2b', 'USER', 'a1'),
    node('a2b', 'ASSISTANT', 'u2b'),
  ];
}

/** Conversa do acervo anterior à feature: ninguém tem antecessor registrado. */
function legacyTree(): TrailNodeRow[] {
  clock = 0;
  return [
    node('l1', 'USER', null),
    node('l2', 'ASSISTANT', null),
    node('l3', 'USER', null),
    node('l4', 'ASSISTANT', null),
  ];
}

/**
 * Finder falso que emula o Postgres: devolve só o que casa com o `where`
 * RECEBIDO. Se a consulta perder o escopo da conversa, o teste vê pelo
 * retorno, não só pela asserção da query.
 */
function fakeNodeFinder(
  rows: readonly TrailNodeRow[],
  conversationId = CONVERSATION,
): { find: TrailNodeFinder; queries: TrailNodeQuery[] } {
  const queries: TrailNodeQuery[] = [];
  const find: TrailNodeFinder = async (query) => {
    queries.push(query);
    if (query.where.conversationId !== conversationId) return [];
    return [...rows];
  };
  return { find, queries };
}

function fakeHistoryFinder(rows: readonly TrailNodeRow[]): {
  find: HistoryFinder;
  queries: HistoryQuery[];
} {
  const queries: HistoryQuery[] = [];
  const find: HistoryFinder = async (query) => {
    queries.push(query);
    // Ordem embaralhada de propósito: o Prisma não garante a ordem de um
    // `id: { in: [...] }`, e numa árvore `createdAt` não serve de desempate.
    return rows
      .filter((row) => query.where.id.in.includes(row.id))
      .map<HistoryRow>((row) => ({
        id: row.id,
        role: row.role,
        kind: row.kind,
        content: `conteúdo de ${row.id}`,
        tools: null,
        segments: null,
        createdAt: row.createdAt,
      }))
      .reverse();
  };
  return { find, queries };
}

describe('resolveActiveTrail', () => {
  test('conversa ramificada devolve só a trilha da folha ativa', () => {
    const nodes = branchedTree();
    expect(resolveActiveTrail(nodes, 'a2b').map((item) => item.id)).toEqual([
      'u1',
      'a1',
      'u2b',
      'a2b',
    ]);
    expect(resolveActiveTrail(nodes, 'a2a').map((item) => item.id)).toEqual([
      'u1',
      'a1',
      'u2a',
      'a2a',
    ]);
  });

  test('conversa anterior à feature vira trilha linear contínua, sem migração', () => {
    const nodes = legacyTree();
    expect(resolveActiveTrail(nodes, null).map((item) => item.id)).toEqual([
      'l1',
      'l2',
      'l3',
      'l4',
    ]);
  });

  test('mensagens novas depois do acervo antigo mantêm o prefixo linear', () => {
    clock = 0;
    const nodes = [...legacyTree(), node('n1', 'USER', 'l4'), node('n2', 'ASSISTANT', 'n1')];
    expect(resolveActiveTrail(nodes, 'n2').map((item) => item.id)).toEqual([
      'l1',
      'l2',
      'l3',
      'l4',
      'n1',
      'n2',
    ]);
  });

  test('ponteiro de folha pendurado cai na última mensagem em vez de sumir com a conversa', () => {
    const nodes = branchedTree();
    expect(resolveActiveTrail(nodes, 'mensagem-apagada').map((item) => item.id)).toEqual([
      'u1',
      'a1',
      'u2b',
      'a2b',
    ]);
  });

  test('conversa vazia devolve trilha vazia', () => {
    expect(resolveActiveTrail([], null)).toEqual([]);
    expect(resolveActiveTrail([], 'qualquer')).toEqual([]);
  });

  test('ciclo em `parentId` não trava a caminhada', () => {
    clock = 0;
    const cyclic: TrailNodeRow[] = [node('c1', 'USER', 'c2'), node('c2', 'ASSISTANT', 'c1')];
    expect(resolveActiveTrail(cyclic, 'c2').map((item) => item.id)).toEqual(['c1', 'c2']);
  });

  test('a caminhada atravessa mensagem compactada em vez de parar nela', () => {
    clock = 0;
    const nodes = [
      node('u1', 'USER', null, { compactedAt: new Date(1) }),
      node('a1', 'ASSISTANT', 'u1', { compactedAt: new Date(1) }),
      node('s1', 'SYSTEM', 'a1', { kind: 'COMPACTION_SUMMARY' }),
      node('u2', 'USER', 's1'),
      node('a2', 'ASSISTANT', 'u2'),
    ];
    const trail = resolveActiveTrail(nodes, 'a2');
    expect(trail.map((item) => item.id)).toEqual(['u1', 'a1', 's1', 'u2', 'a2']);
    // A filtragem por `compactedAt` acontece DEPOIS da caminhada. Filtrar
    // antes quebraria a corrente no ponto compactado e esconderia o recente.
    expect(activeTrailIds(trail)).toEqual(['s1', 'u2', 'a2']);
  });
});

describe('loadActiveHistory — histórico enviado ao modelo', () => {
  test('contém apenas a trilha ativa; a trilha abandonada não vaza', async () => {
    const nodes = branchedTree();
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows, queries } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(CONVERSATION, 'a2b', {}, { findNodes, findRows });

    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2b', 'a2b']);
    expect(history.map((row) => row.id)).not.toContain('u2a');
    expect(history.map((row) => row.id)).not.toContain('a2a');
    // A consulta pesada carrega o escopo da conversa junto dos ids.
    expect(queries[0]?.where.conversationId).toBe(CONVERSATION);
  });

  test('trocar a folha ativa troca o histórico inteiro a partir da ramificação', async () => {
    const nodes = branchedTree();
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(CONVERSATION, 'a2a', {}, { findNodes, findRows });

    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2a', 'a2a']);
    expect(history.map((row) => row.id)).not.toContain('u2b');
  });

  test('a resposta em construção não entra no próprio prompt', async () => {
    const nodes = branchedTree();
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(
      CONVERSATION,
      'a2b',
      { excludeId: 'a2b' },
      { findNodes, findRows },
    );

    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2b']);
  });

  test('mensagem compactada sai do prompt, o resumo da trilha fica', async () => {
    clock = 0;
    const nodes = [
      node('u1', 'USER', null, { compactedAt: new Date(1) }),
      node('a1', 'ASSISTANT', 'u1', { compactedAt: new Date(1) }),
      node('s1', 'SYSTEM', 'a1', { kind: 'COMPACTION_SUMMARY' }),
      node('u2', 'USER', 's1'),
    ];
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(CONVERSATION, 'u2', {}, { findNodes, findRows });

    expect(history.map((row) => row.id)).toEqual(['s1', 'u2']);
  });

  test('a ordem é a da caminhada, não a que o banco devolveu', async () => {
    const nodes = branchedTree();
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(CONVERSATION, 'a2b', {}, { findNodes, findRows });

    // `fakeHistoryFinder` devolve invertido de propósito.
    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2b', 'a2b']);
  });

  test('conversa vazia não consulta as linhas completas', async () => {
    const { find: findNodes } = fakeNodeFinder([]);
    const { find: findRows, queries } = fakeHistoryFinder([]);

    expect(await loadActiveHistory(CONVERSATION, null, {}, { findNodes, findRows })).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

describe('loadConversationTrail', () => {
  test('a consulta de nós carrega o escopo da conversa', async () => {
    const { find, queries } = fakeNodeFinder(branchedTree());
    await loadConversationTrail(CONVERSATION, 'a2b', find);
    expect(queries[0]?.where.conversationId).toBe(CONVERSATION);
  });

  test('conversa de outro escopo devolve trilha vazia', async () => {
    const { find } = fakeNodeFinder(branchedTree(), 'outra-conversa');
    const { trail } = await loadConversationTrail(CONVERSATION, 'a2b', find);
    expect(trail).toEqual([]);
  });
});

describe('buildVersionGroups', () => {
  test('ponto de ramificação expõe posição e total', () => {
    const nodes = branchedTree();
    const groups = buildVersionGroups(nodes, resolveActiveTrail(nodes, 'a2b'));
    expect(groups.get('u2b')).toEqual({ index: 2, total: 2, ids: ['u2a', 'u2b'] });
    // A trilha antiga vê o mesmo grupo, na posição dela.
    const older = buildVersionGroups(nodes, resolveActiveTrail(nodes, 'a2a'));
    expect(older.get('u2a')).toEqual({ index: 1, total: 2, ids: ['u2a', 'u2b'] });
  });

  test('mensagem sem irmã não recebe indicador', () => {
    const nodes = branchedTree();
    const groups = buildVersionGroups(nodes, resolveActiveTrail(nodes, 'a2b'));
    expect(groups.has('u1')).toBe(false);
    expect(groups.has('a2b')).toBe(false);
  });

  test('conversa do acervo antigo não exibe indicador em lugar nenhum', () => {
    const nodes = legacyTree();
    const groups = buildVersionGroups(nodes, resolveActiveTrail(nodes, null));
    expect(groups.size).toBe(0);
  });

  test('a raiz também pode ter versões depois do encadeamento', () => {
    clock = 0;
    const nodes = [
      node('r1', 'USER', null),
      node('ra', 'ASSISTANT', 'r1'),
      node('r2', 'USER', null),
      node('rb', 'ASSISTANT', 'r2'),
    ];
    // Duas mensagens sem antecessor: sem saber se é acervo antigo ou raiz
    // versionada, o indicador NÃO aparece — é o lado seguro do trade-off.
    expect(isLinearized(nodes)).toBe(false);
    expect(buildVersionGroups(nodes, resolveActiveTrail(nodes, 'rb')).size).toBe(0);
  });
});

describe('resolveDeepestLeaf', () => {
  test('desce até a folha escolhendo o ramo mais recente', () => {
    const nodes = branchedTree();
    expect(resolveDeepestLeaf(nodes, 'u2a')).toBe('a2a');
    expect(resolveDeepestLeaf(nodes, 'a1')).toBe('a2b');
    expect(resolveDeepestLeaf(nodes, 'u1')).toBe('a2b');
  });

  test('folha devolve a si mesma e id inexistente devolve nulo', () => {
    const nodes = branchedTree();
    expect(resolveDeepestLeaf(nodes, 'a2b')).toBe('a2b');
    expect(resolveDeepestLeaf(nodes, 'nao-existe')).toBeNull();
  });
});

describe('planLinearization', () => {
  test('encadeia o acervo antigo na ordem de criação e é idempotente', () => {
    const nodes = legacyTree();
    const plan = planLinearization(nodes);
    expect(plan).toEqual([
      { id: 'l2', parentId: 'l1' },
      { id: 'l3', parentId: 'l2' },
      { id: 'l4', parentId: 'l3' },
    ]);

    const applied = nodes.map((item) => {
      const step = plan.find((entry) => entry.id === item.id);
      return step ? { ...item, parentId: step.parentId } : item;
    });
    expect(planLinearization(applied)).toEqual([]);
    expect(isLinearized(applied)).toBe(true);
    // A sequência da trilha não muda com o encadeamento.
    expect(resolveActiveTrail(applied, null).map((item) => item.id)).toEqual(
      resolveActiveTrail(nodes, null).map((item) => item.id),
    );
  });

  test('conversa já encadeada não gera plano', () => {
    expect(planLinearization(branchedTree())).toEqual([]);
  });
});

describe('orderByTrail', () => {
  test('descarta id que não voltou do banco em vez de furar a ordem', () => {
    const rows = [{ id: 'b' }, { id: 'a' }];
    expect(orderByTrail(rows, ['a', 'sumiu', 'b'])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
