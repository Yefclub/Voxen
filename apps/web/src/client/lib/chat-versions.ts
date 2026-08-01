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
