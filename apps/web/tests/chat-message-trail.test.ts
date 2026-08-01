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
  applyLinearization,
  buildVersionGroups,
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

/** Conversa encadeada em que o usuário versionou a PRIMEIRA mensagem. */
function rootVersionedTree(): TrailNodeRow[] {
  clock = 0;
  return [
    node('r1', 'USER', null),
    node('ra', 'ASSISTANT', 'r1'),
    // Versão da raiz: irmã de `r1`, portanto também sem antecessor.
    node('r2', 'USER', null),
    node('rb', 'ASSISTANT', 'r2'),
  ];
}

const LINEARIZED = { linearized: true } as const;

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

  test('mensagem criada sem antecessor cai FORA da trilha — invariante de escrita', () => {
    // Toda escrita de mensagem tem que pendurar no fim da trilha ativa. Este
    // teste fixa a consequência de esquecer: numa conversa encadeada, o nó
    // órfão desaparece do histórico e o modelo nunca mais o vê. Foi assim que
    // a mensagem de confirmação do HITL sumia da conversa.
    const nodes = [...branchedTree(), node('orfa', 'SYSTEM', null)];
    const trail = resolveActiveTrail(nodes, 'a2b', LINEARIZED);

    expect(trail.map((item) => item.id)).not.toContain('orfa');

    // Pendurada corretamente na folha, entra na trilha e nada mais quebra.
    const attached = [...branchedTree(), node('ligada', 'SYSTEM', 'a2b')];
    const attachedTrail = resolveActiveTrail(attached, 'ligada', LINEARIZED);
    expect(attachedTrail.map((item) => item.id)).toEqual(['u1', 'a1', 'u2b', 'a2b', 'ligada']);
    expect(buildVersionGroups(attached, attachedTrail, LINEARIZED).get('u2b')?.total).toBe(2);
  });

  test('versionar a mensagem RAIZ não traz a versão abandonada de volta', () => {
    // Regressão: a regra de prefixo linear prependia toda mensagem sem
    // antecessor mais antiga que a raiz da caminhada. Numa conversa encadeada
    // em que o usuário versionou a primeira mensagem, isso reinjetava a
    // pergunta substituída no prompt — duas mensagens USER seguidas — que é
    // exatamente o vazamento silencioso que a spec 127 trata como risco nº 1.
    const nodes = rootVersionedTree();

    expect(resolveActiveTrail(nodes, 'rb', LINEARIZED).map((item) => item.id)).toEqual([
      'r2',
      'rb',
    ]);
    expect(resolveActiveTrail(nodes, 'ra', LINEARIZED).map((item) => item.id)).toEqual([
      'r1',
      'ra',
    ]);
  });

  test('sem a marca de encadeamento a mesma árvore ainda usa o prefixo linear', () => {
    // Conversa antiga de verdade: nada é versão de nada, e a leitura precisa
    // costurar as mensagens soltas numa trilha só.
    const nodes = rootVersionedTree();
    expect(resolveActiveTrail(nodes, 'rb').map((item) => item.id)).toEqual(['r1', 'r2', 'rb']);
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

    const history = await loadActiveHistory(
      CONVERSATION,
      { activeLeafId: 'a2b', linearized: true },
      {},
      { findNodes, findRows },
    );

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

    const history = await loadActiveHistory(
      CONVERSATION,
      { activeLeafId: 'a2a', linearized: true },
      {},
      { findNodes, findRows },
    );

    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2a', 'a2a']);
    expect(history.map((row) => row.id)).not.toContain('u2b');
  });

  test('a resposta em construção não entra no próprio prompt', async () => {
    const nodes = branchedTree();
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(
      CONVERSATION,
      { activeLeafId: 'a2b', linearized: true },
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

    const history = await loadActiveHistory(
      CONVERSATION,
      { activeLeafId: 'u2', linearized: true },
      {},
      { findNodes, findRows },
    );

    expect(history.map((row) => row.id)).toEqual(['s1', 'u2']);
  });

  test('a ordem é a da caminhada, não a que o banco devolveu', async () => {
    const nodes = branchedTree();
    const { find: findNodes } = fakeNodeFinder(nodes);
    const { find: findRows } = fakeHistoryFinder(nodes);

    const history = await loadActiveHistory(
      CONVERSATION,
      { activeLeafId: 'a2b', linearized: true },
      {},
      { findNodes, findRows },
    );

    // `fakeHistoryFinder` devolve invertido de propósito.
    expect(history.map((row) => row.id)).toEqual(['u1', 'a1', 'u2b', 'a2b']);
  });

  test('conversa vazia não consulta as linhas completas', async () => {
    const { find: findNodes } = fakeNodeFinder([]);
    const { find: findRows, queries } = fakeHistoryFinder([]);

    expect(
      await loadActiveHistory(CONVERSATION, { activeLeafId: null }, {}, { findNodes, findRows }),
    ).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

describe('loadConversationTrail', () => {
  test('a consulta de nós carrega o escopo da conversa', async () => {
    const { find, queries } = fakeNodeFinder(branchedTree());
    await loadConversationTrail(CONVERSATION, { activeLeafId: 'a2b' }, find);
    expect(queries[0]?.where.conversationId).toBe(CONVERSATION);
  });

  test('conversa de outro escopo devolve trilha vazia', async () => {
    const { find } = fakeNodeFinder(branchedTree(), 'outra-conversa');
    const { trail } = await loadConversationTrail(CONVERSATION, { activeLeafId: 'a2b' }, find);
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

  test('a raiz TEM indicador de versão em conversa encadeada', () => {
    const nodes = rootVersionedTree();
    const trail = resolveActiveTrail(nodes, 'rb', LINEARIZED);
    expect(buildVersionGroups(nodes, trail, LINEARIZED).get('r2')).toEqual({
      index: 2,
      total: 2,
      ids: ['r1', 'r2'],
    });
  });

  test('a mesma árvore SEM a marca de encadeamento não inventa indicador', () => {
    // Acervo antigo tem várias mensagens sem antecessor e nenhuma delas é
    // versão de outra. Sem a marca, agrupar seria indicador falso.
    const nodes = rootVersionedTree();
    const trail = resolveActiveTrail(nodes, 'rb');
    expect(buildVersionGroups(nodes, trail).size).toBe(0);
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

    const applied = applyLinearization(nodes, plan);
    expect(planLinearization(applied)).toEqual([]);
    // A sequência da trilha é a mesma antes e depois do encadeamento — é o que
    // permite encadear no meio de uma transação sem recarregar do banco.
    expect(resolveActiveTrail(applied, null, LINEARIZED).map((item) => item.id)).toEqual(
      resolveActiveTrail(nodes, null).map((item) => item.id),
    );
  });

  test('conversa já encadeada não gera plano', () => {
    expect(planLinearization(branchedTree())).toEqual([]);
  });

  test('o replano após aplicação PARCIAL converge para a mesma árvore', () => {
    // Regressão: três dos quatro chamadores aplicam o plano fora de transação,
    // um UPDATE por mensagem. Interrompido no meio (deploy, restart), o
    // replano precisa terminar o serviço, não montar outra árvore. Encadeando
    // entre os "sem antecessor", o nó já corrigido saía do cálculo, o seguinte
    // pulava por cima dele, e a mensagem pulada virava ramo morto — sumia da
    // UI e do prompt em silêncio, para sempre.
    const nodes = legacyTree();
    const completo = planLinearization(nodes);

    // Aplica só o primeiro passo e "cai".
    const parcial = applyLinearization(nodes, completo.slice(0, 1));
    expect(parcial.map((item) => item.parentId)).toEqual([null, 'l1', null, null]);

    const replano = planLinearization(parcial);
    const final = applyLinearization(parcial, replano);

    expect(final.map((item) => `${item.id}<-${String(item.parentId)}`)).toEqual([
      'l1<-null',
      'l2<-l1',
      'l3<-l2',
      'l4<-l3',
    ]);
    // Nenhuma mensagem vira ramo morto: a trilha continua completa.
    expect(resolveActiveTrail(final, null, LINEARIZED).map((item) => item.id)).toEqual([
      'l1',
      'l2',
      'l3',
      'l4',
    ]);
    // E o resultado é o mesmo de aplicar o plano completo de uma vez.
    expect(applyLinearization(nodes, completo).map((item) => item.parentId)).toEqual(
      final.map((item) => item.parentId),
    );
  });
});

describe('orderByTrail', () => {
  test('descarta id que não voltou do banco em vez de furar a ordem', () => {
    const rows = [{ id: 'b' }, { id: 'a' }];
    expect(orderByTrail(rows, ['a', 'sumiu', 'b'])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
