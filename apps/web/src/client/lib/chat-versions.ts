// ============================================================================
// Navegação entre versões de uma mensagem do usuário (spec 127, Parte 2)
// ----------------------------------------------------------------------------
// O servidor já resolve a trilha e entrega, SÓ em ponto de ramificação, a
// posição da mensagem entre suas versões irmãs. Aqui mora apenas o que o
// cliente decide em cima disso — qual irmã o `‹` e o `›` ativam, e o que
// desaparece da tela no instante em que o usuário reenvia uma mensagem
// editada.
//
// Por que é um módulo puro e não lógica solta dentro de `chat.tsx`: as duas
// funções abaixo erram em silêncio. Um `‹` que ativa o id errado troca a
// conversa inteira sem avisar, e um corte de trilha que não acha o ponto de
// ramificação deixa a versão antiga e a nova lado a lado na mesma tela. Nada
// disso quebra render, então só teste comportamental pega.
// ============================================================================

import { mergeChatMessagePages } from './chat-pagination';

/**
 * Posição da mensagem entre suas versões irmãs, como o snapshot entrega
 * (`buildVersionGroups` em `lib/chat/message-trail.ts`). Chega `null` em
 * mensagem sem ramificação — a esmagadora maioria.
 */
export interface MessageVersions {
  /** 1-based, para exibir "2/3". */
  index: number;
  total: number;
  /** Ids das versões em ordem de criação. */
  ids: string[];
}

/** Só ponto de ramificação exibe indicador; conversa sem versão fica limpa. */
export function hasMessageVersions(
  versions: MessageVersions | null | undefined,
): versions is MessageVersions {
  return versions != null && versions.total > 1 && Array.isArray(versions.ids);
}

/**
 * Id da versão vizinha na direção pedida (`-1` = anterior, `1` = próxima), ou
 * `null` quando não há para onde ir.
 *
 * O limite sai de `ids` — o acesso fora do intervalo devolve `undefined` nas
 * duas pontas —, nunca de `total`. `total` só alimenta o rótulo; se os dois
 * divergirem, é melhor a seta nascer desabilitada do que disparar um POST para
 * `/messages/undefined/activate`. Uma checagem explícita de intervalo ao lado
 * do `?? null` seria redundante: cada uma sozinha já cobre o caso, então
 * nenhum teste conseguiria derrubar a outra.
 */
export function versionNeighborId(
  versions: MessageVersions | null | undefined,
  direction: -1 | 1,
): string | null {
  if (!hasMessageVersions(versions)) return null;
  return versions.ids[versions.index - 1 + direction] ?? null;
}

/**
 * Lista a exibir ao desfazer o corte otimista, ou `null` para NÃO desfazer.
 *
 * O rollback existe para o caso em que o reenvio não produziu nada e a tela
 * ficaria com o prefixo cortado mais duas bolhas órfãs. Ele é correto só
 * enquanto a versão nova não existe.
 *
 * `versionCreated` é o que separa os dois mundos, e o sinal certo para ele é a
 * ACEITAÇÃO do POST, não o evento `start`: a rota cria o turno antes de abrir
 * o stream (`createChatTurn` e só então `streamTurnResponse`), então uma
 * resposta 2xx já significa que a versão existe e que a trilha ativa mudou.
 * Entre o 2xx e o primeiro frame existe uma janela em que a versão está no
 * banco e `start` ainda não chegou; usar `start` como sinal restauraria ali.
 *
 * Com a versão criada, restaurar é pior que não restaurar. As bolhas otimistas
 * deixam de ser descartáveis assim que `reconcileChatStart` troca os ids
 * `local-*` pelos reais, e a união com a lista pré-corte devolveria a mensagem
 * editada e todo o rabo dela AO LADO da versão nova — as duas versões da mesma
 * pergunta empilhadas, exatamente o que o corte existe para evitar. Prefixo +
 * versão nova é incompleto, mas correto; um reload traz o resto.
 *
 * O cenário não é exótico: reenvio aceito e a rede caindo durante a geração
 * derruba o stream E o snapshot de recuperação pelo mesmo motivo — que é
 * justamente quando o rollback é chamado. Um 502 do proxy no GET de
 * recuperação basta, com o turno vivo do outro lado.
 */
export function planBranchRollback<T extends { id: string; createdAt: string }>(params: {
  trailBeforeBranch: readonly T[] | null;
  current: readonly T[];
  /** O servidor aceitou o reenvio, ou seja: a versão já existe no banco. */
  versionCreated: boolean;
}): T[] | null {
  const { trailBeforeBranch, current, versionCreated } = params;
  if (!trailBeforeBranch) return null;
  if (versionCreated) return null;
  return mergeChatMessagePages(
    trailBeforeBranch,
    // O que estiver mais fresco na tela vence; as bolhas otimistas saem.
    current.filter((message) => !message.id.startsWith('local-')),
  );
}

/** Para onde o envio vai e o que ele consome do composer. */
export interface SendPlan {
  endpoint: string;
  attachmentJobIds: string[];
  /** `false` num reenvio de versão: o composer não é dele. */
  clearsComposer: boolean;
}

/**
 * Decide as três coisas que mudam entre um envio normal e um reenvio de versão.
 *
 * Vive aqui, e não inline na página, porque as três erram em silêncio: a URL
 * errada manda a versão para o endpoint de mensagem nova (perde a ramificação),
 * herdar os anexos errados troca o arquivo da pergunta pelo que estava
 * preparado no composer, e limpar o composer num reenvio apaga um rascunho que
 * o usuário não mandou. Nenhuma das três quebra render — só teste pega.
 */
export function planSend(params: {
  branch?: { messageId: string; attachments: readonly { jobId: string }[] };
  composerJobIds: readonly string[];
}): SendPlan {
  const { branch, composerJobIds } = params;
  if (!branch) {
    return {
      endpoint: '/api/chat',
      attachmentJobIds: [...composerJobIds],
      clearsComposer: true,
    };
  }
  return {
    // `encodeURIComponent` não é cerimônia: o id entra num segmento de caminho.
    endpoint: `/api/chat/messages/${encodeURIComponent(branch.messageId)}/versions`,
    // A versão herda os anexos da mensagem editada — o servidor re-vincula os
    // mesmos jobs com escopo de workspace, sem novo upload.
    attachmentJobIds: branch.attachments.map((item) => item.jobId),
    clearsComposer: false,
  };
}

/**
 * Recorta a trilha exibida no ponto de ramificação: remove a mensagem editada
 * e tudo que veio depois dela, deixando espaço para a versão nova e a resposta
 * que o turno vai gerar.
 *
 * A mensagem editada PRECISA sair da tela. Ela não pertence à trilha nova (a
 * versão nasce irmã dela, não filha), então o snapshot seguinte não a traz de
 * volta — e a mesclagem de páginas preserva o que já estava no cliente. Sem o
 * corte, as duas versões da mesma pergunta ficam empilhadas na conversa.
 *
 * Id ausente devolve a lista intacta: um ponteiro velho não pode esvaziar a
 * conversa do usuário.
 */
export function truncateTrailFrom<T extends { id: string }>(
  messages: readonly T[],
  messageId: string,
): T[] {
  const index = messages.findIndex((message) => message.id === messageId);
  return index < 0 ? [...messages] : messages.slice(0, index);
}
