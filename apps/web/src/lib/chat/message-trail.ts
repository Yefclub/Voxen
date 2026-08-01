// ============================================================================
// Resolução da trilha ativa da conversa (spec 127)
// ----------------------------------------------------------------------------
// A conversa deixou de ser lista e virou ÁRVORE: cada mensagem aponta para a
// anterior (`parentId`) e a conversa guarda a folha ativa (`activeLeafId`). A
// "trilha ativa" é a caminhada folha → raiz, invertida.
//
// Por que este módulo é PURO (sem Prisma) e por que TODA leitura de histórico
// passa por aqui: numa árvore, `createdAt` deixa de definir a sequência — uma
// versão criada depois pode estar acima na trilha. Se cada leitura reimplementar
// o filtro, uma delas esquece e vaza mensagem de outra trilha para dentro do
// contexto do modelo. Esse é o modo de falha mais caro e mais silencioso da
// spec 127, então a ordem mora num lugar só, testável sem banco.
//
// Compatibilidade com o acervo anterior à feature: aquelas mensagens têm
// `parentId` nulo. Se a caminhada terminar numa raiz sem antecessor, tudo que
// também não tem antecessor e é mais antigo que ela forma o prefixo linear —
// é a "trilha única e contínua" que a spec exige para conversas antigas.
// ============================================================================

/** Mínimo que a resolução precisa de uma mensagem. */
export interface TrailNode {
  id: string;
  parentId: string | null;
  createdAt: Date;
}

/** Nó com papel, necessário para agrupar versões (só mensagem do usuário). */
export interface RoleTrailNode extends TrailNode {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
}

/** Posição de uma mensagem entre suas versões irmãs. */
export interface VersionGroup {
  /** 1-based, para exibir "2/3". */
  index: number;
  total: number;
  /** Ids das versões em ordem de criação. */
  ids: string[];
}

/** Chave do grupo da raiz — `parentId` nulo não pode ser chave de Map. */
const ROOT_GROUP_KEY = ' root';

/** Ordem de criação estável: `createdAt` e, no empate, `id`. */
export function compareByCreation(a: TrailNode, b: TrailNode): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime();
  if (delta !== 0) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sortedByCreation<T extends TrailNode>(nodes: readonly T[]): T[] {
  return [...nodes].sort(compareByCreation);
}

/**
 * Estado do encadeamento da conversa, vindo de `Conversation.messagesLinearized`.
 *
 * `false` = acervo anterior à feature, com todas as mensagens sem antecessor:
 * a leitura precisa da regra de prefixo linear e não pode agrupar versões na
 * raiz. `true` = árvore de verdade, onde "sem antecessor" significa raiz e
 * NADA mais.
 *
 * Tem que ser explícito, não inferido de "quantas mensagens estão sem
 * antecessor": versionar a primeira mensagem cria uma segunda raiz legítima, e
 * a inferência leria isso como acervo antigo — prependendo a versão abandonada
 * no histórico enviado ao modelo, que é o risco nº 1 da spec.
 */
export interface TrailOptions {
  linearized?: boolean;
}

/**
 * Caminhada folha → raiz, devolvida da raiz para a folha.
 *
 * `activeLeafId` ausente ou apontando para mensagem inexistente cai na última
 * mensagem por ordem de criação — é o que mantém a conversa antiga (que nunca
 * teve ponteiro de folha) visível sem migração de dados.
 */
export function resolveActiveTrail<T extends TrailNode>(
  nodes: readonly T[],
  activeLeafId: string | null | undefined,
  options: TrailOptions = {},
): T[] {
  if (nodes.length === 0) return [];
  const byId = new Map<string, T>();
  for (const node of nodes) byId.set(node.id, node);

  const leaf =
    (activeLeafId ? byId.get(activeLeafId) : undefined) ?? sortedByCreation(nodes).at(-1);
  if (!leaf) return [];

  const chain: T[] = [];
  const seen = new Set<string>();
  let current: T | undefined = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const root = chain.at(-1);
  chain.reverse();
  // Conversa já encadeada: a caminhada é a trilha inteira. Nada é prependido,
  // senão versionar a raiz traria a versão abandonada de volta.
  if (options.linearized) return chain;
  // Antecessor pendurado (dado inconsistente) não habilita o prefixo linear:
  // prepender mensagens soltas ali inventaria histórico.
  if (!root || root.parentId !== null) return chain;

  const legacyPrefix = sortedByCreation(
    nodes.filter((node) => node.parentId === null && compareByCreation(node, root) < 0),
  );
  return [...legacyPrefix, ...chain];
}

/**
 * Aplica em memória o encadeamento que acabou de ser gravado, para que a
 * mesma transação siga trabalhando com a árvore já corrigida em vez de
 * reconsultar o banco.
 */
export function applyLinearization<T extends TrailNode>(
  nodes: readonly T[],
  plan: readonly { id: string; parentId: string }[],
): T[] {
  if (plan.length === 0) return [...nodes];
  const parentById = new Map(plan.map((step) => [step.id, step.parentId]));
  return nodes.map((node) => {
    const parentId = parentById.get(node.id);
    return parentId === undefined ? node : { ...node, parentId };
  });
}

/**
 * Descendente mais profundo a partir de `fromId`, escolhendo em cada bifurcação
 * o filho criado por último. É a folha que o ponteiro da conversa passa a
 * apontar quando o usuário ativa uma versão: navegar entre versões nunca gera
 * resposta nova, só reposiciona a trilha.
 */
export function resolveDeepestLeaf<T extends TrailNode>(
  nodes: readonly T[],
  fromId: string,
): string | null {
  const childrenByParent = new Map<string, T[]>();
  let start: T | undefined;
  for (const node of nodes) {
    if (node.id === fromId) start = node;
    if (node.parentId === null) continue;
    const bucket = childrenByParent.get(node.parentId);
    if (bucket) bucket.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }
  if (!start) return null;

  let current: T = start;
  const seen = new Set<string>([current.id]);
  for (;;) {
    const children = childrenByParent.get(current.id);
    if (!children || children.length === 0) return current.id;
    const next = sortedByCreation(children).at(-1);
    if (!next || seen.has(next.id)) return current.id;
    seen.add(next.id);
    current = next;
  }
}

/**
 * Grupos de versão das mensagens do usuário presentes na trilha.
 *
 * Só entra no mapa quem tem irmã — ponto sem ramificação não exibe indicador,
 * que é o critério de aceite para conversas antigas continuarem limpas.
 */
export function buildVersionGroups<T extends RoleTrailNode>(
  nodes: readonly T[],
  trail: readonly T[],
  options: TrailOptions = {},
): Map<string, VersionGroup> {
  const groups = new Map<string, VersionGroup>();
  if (trail.length === 0) return groups;
  const linearized = options.linearized === true;

  const siblingsByParent = new Map<string, T[]>();
  for (const node of nodes) {
    if (node.role !== 'USER') continue;
    // Sem antecessor em conversa não encadeada não há grupo: são mensagens do
    // acervo antigo, sequenciais, não versões. Já encadeada, "sem antecessor"
    // significa raiz — e a raiz pode ter versões como qualquer outro ponto.
    if (node.parentId === null && !linearized) continue;
    const key = node.parentId ?? ROOT_GROUP_KEY;
    const bucket = siblingsByParent.get(key);
    if (bucket) bucket.push(node);
    else siblingsByParent.set(key, [node]);
  }

  for (const node of trail) {
    if (node.role !== 'USER') continue;
    if (node.parentId === null && !linearized) continue;
    const siblings = siblingsByParent.get(node.parentId ?? ROOT_GROUP_KEY);
    if (!siblings || siblings.length <= 1) continue;
    const ordered = sortedByCreation(siblings);
    const index = ordered.findIndex((item) => item.id === node.id);
    if (index < 0) continue;
    groups.set(node.id, {
      index: index + 1,
      total: ordered.length,
      ids: ordered.map((item) => item.id),
    });
  }
  return groups;
}

/**
 * Encadeamento a aplicar numa conversa do acervo antigo: cada mensagem sem
 * antecessor passa a apontar para a IMEDIATAMENTE anterior em ordem de
 * criação — considerando todas as mensagens, não só as sem antecessor — e a
 * mais antiga de todas vira a raiz.
 *
 * Isso NÃO é migração de deploy: é preguiçoso, por conversa, e roda só quando
 * a conversa recebe uma escrita estrutural (novo turno, nova versão, troca de
 * trilha, compactação). Conversa que ninguém abre continua legível pela regra
 * de prefixo linear em `resolveActiveTrail`, sem nunca ser tocada.
 *
 * Por que o predecessor é o imediato entre TODOS os nós, e não o "sem
 * antecessor anterior": três dos quatro chamadores aplicam o plano fora de
 * transação, um UPDATE por mensagem. Interrompido no meio (deploy, restart), o
 * replano tem que convergir para a MESMA árvore. Encadeando pelo predecessor
 * imediato, um nó já corrigido continua sendo o alvo do próximo — replanejar
 * sobre o estado parcial devolve exatamente o que faltava. Encadeando entre os
 * "sem antecessor", o nó já corrigido some do cálculo, o seguinte pula por
 * cima dele, e a mensagem pulada vira ramo morto: some da UI e do prompt em
 * silêncio, para sempre.
 *
 * Pré-condição: a conversa ainda NÃO está marcada como encadeada. Numa árvore
 * de verdade, uma segunda mensagem sem antecessor é uma versão legítima da
 * raiz e não pode ser encadeada — por isso `ensureConversationLinearized`
 * retorna cedo quando a marca existe.
 */
export function planLinearization(
  nodes: readonly TrailNode[],
): Array<{ id: string; parentId: string }> {
  const ordered = sortedByCreation(nodes);
  const plan: Array<{ id: string; parentId: string }> = [];
  // Começa em 1: a mensagem mais antiga da conversa é a raiz e fica sem
  // antecessor.
  for (let index = 1; index < ordered.length; index += 1) {
    const node = ordered[index];
    const previous = ordered[index - 1];
    if (!node || !previous || node.parentId !== null) continue;
    plan.push({ id: node.id, parentId: previous.id });
  }
  return plan;
}
