# 130 — Polimento de interface: bloco de raciocínio, ícones, sidebar e versões

## Contexto

Quatro problemas de interface levantados em uso real, todos já localizados
na fonte. Três são acabamento; o primeiro é um defeito de comportamento que
torna o chat desconfortável de usar.

### 1. O bloco "Pensando" abre e fecha durante o turno

Palavras do owner: *"durante o raciocínio e uso de ferramentas, a interface
fica pulando de tanto que abre e fecha o 'Pensando'"*.

Causa confirmada em `apps/web/src/client/pages/chat.tsx:329-339`, onde
`expanded` está amarrado diretamente a `inFlight`:

```ts
if (!inFlight) { setExpanded(false); return; }
setExpanded(true);
```

E `inFlight` (`apps/web/src/client/lib/chat-segments.ts:303-311`) oscila
dentro do mesmo turno, porque `answering` é `message.content.length > 0`:
sem texto → `true`; chega texto → `false` (fecha); nova ferramenta → `true`
(abre); termina → `false` (fecha). **Um ciclo abre/fecha por ida-e-volta de
ferramenta.** Não é problema de rolagem — é o gatilho errado.

O `Reasoning` do `vercel/ai-elements` resolve o mesmo problema com três
garantias que não temos: atraso antes de fechar, fechar **uma vez só** por
turno, e parar de dirigir o estado se o usuário clicou.

O mesmo gatilho errado também dirige o **rótulo** do cabeçalho, que alterna
entre o shimmer "Pensando" e o resumo "Pensou por Xs · N ferramentas" a cada
ferramenta — trocando texto e largura no meio da resposta. É metade da queixa
do owner (ele fala do "Pensando", não do bloco) e contraria a regra explícita
da `.specs/078` § "Gaps entre tools … NÃO devem colapsar o bloco nem trocar o
cabeçalho para 'Pensou por Xs'". Bloco e cabeçalho passam a ser dirigidos pelo
mesmo `live`.

### 2. Animação do ícone não dispara pelo botão que o contém

Palavras do owner: *"Eles estão executando a animação somente quando o mouse
passa sobre o ícones, mas passar sobre os botões que contém os ícones também
deveria ter a animação"*.

`accessibleIcon` (`apps/web/src/client/components/ui/icons.ts:128-165`)
instala `onMouseEnter`/`onMouseLeave` no **frame do próprio ícone**, então a
área sensível é o glifo, não o alvo de clique.

### 3. Sidebar colapsada perde "novidades" e "sair"

Palavras do owner: *"não temos os botões de novidades nem de sair com a
sidebar fechada, temos que adicionar"*.

Em `apps/web/src/client/components/layout/sidebar.tsx`, o ramo `collapsed`
renderiza só `<SidebarRail>` (linha 148); `<SidebarChangelogButton />` e
`<SidebarSignOut />` vivem no ramo `!collapsed` (linhas 171-172).

### 4. Indicador de versão não some no hover

Palavras do owner: *"O 2/2 de versionamento, não está ficando invisível como
os outros botões ao passar o mouse sobre a mensagem"*.

Em `apps/web/src/client/components/chat/message-versioning.tsx:74` o nav de
versões não usa `ACTION_REVEAL` (linha 36), aplicado só ao botão de editar
(linha 159). **Isso era decisão deliberada da spec 127 § Parte 2**
("indicador sempre visível, ações no hover" — contador é estado, não ação).
O owner pediu o contrário; a decisão dele prevalece e a 127 precisa ser
corrigida junto, senão o código passa a contradizer a spec versionada.

## Requisitos

### Ubiquitous

- The system shall respeitar `prefers-reduced-motion` em qualquer animação
  tocada por esta spec.
- The system shall manter disponíveis, com a navegação colapsada, as mesmas
  ações de conta e novidades disponíveis com ela expandida.

### Event-driven

- When um turno do assistente começa, the system shall abrir o bloco de
  raciocínio uma única vez.
- When o turno termina, the system shall recolher o bloco de raciocínio uma
  única vez, após um atraso curto.
- When o usuário aciona manualmente o bloco de raciocínio, the system shall
  parar de controlá-lo automaticamente até o fim daquele turno.
- When o ponteiro entra no controle que contém um ícone animado, the system
  shall executar a animação daquele ícone.
- When o ponteiro está sobre uma mensagem com mais de uma versão, the system
  shall revelar o indicador de versão junto das demais ações da mensagem.

### State-driven

- While um turno está em andamento, the system shall manter o bloco de
  raciocínio em um estado estável — sem alternar entre aberto e fechado a
  cada uso de ferramenta.

### Unwanted behavior

- If a animação de hover dos ícones for alterada, then the system shall
  preservar o disparo pelo próprio ícone — a área do glifo continua sensível,
  o controle apenas passa a ser sensível também.

## Critérios de Aceite

- [x] Turno agêntico com várias ferramentas: o bloco de raciocínio não
      alterna entre aberto e fechado durante o turno — nem o rótulo do
      cabeçalho alterna entre "Pensando" e o resumo.
- [x] Clicar no bloco durante o turno impede que ele volte a se mover
      sozinho até o turno acabar.
- [x] Passar o ponteiro sobre um botão anima o ícone dentro dele; passar
      sobre o ícone continua animando.
- [x] Sidebar colapsada oferece novidades e sair, com rótulo acessível.
- [x] Indicador de versão aparece e some junto das outras ações da mensagem.
- [x] `.specs/127` corrigida no ponto que a decisão do owner revoga.
- [x] Testes cobrindo a lógica de abertura/fechamento do bloco de raciocínio
      (função pura, não `grep` de texto-fonte).

## Fora de Escopo

- Trocar o colapsável por biblioteca de terceiro — o `grid-template-rows`
  atual funciona.
- Redesenho da sidebar ou do bloco de raciocínio.
- Mudar o conteúdo exibido no raciocínio (spec 126 já definiu).

## Riscos / Decisões pendentes

- **`icons.ts` é o arquivo mais perigoso do app.** O comentário em
  `icons.ts:150-157` avisa: remover ou deixar de repassar os handlers mata a
  animação de hover dos 102 ícones em silêncio, sem erro de tipo e sem
  quebrar tela. `icons.test.ts` trava os dois lados e 8 mutações já foram
  provadas contra ele. Estender o disparo ao controle não pode custar o
  disparo pelo ícone.
- **O item 1 revoga a decisão nº 2 da spec 126** ("sair de voo quando a
  resposta final começa"), anotada lá no mesmo commit. Voltar o gatilho para
  `live` traz de volta a timeline aberta durante a digitação da resposta — o
  incômodo que a 126 queria remover. É uma troca consciente: um bloco que
  ocupa espaço de forma previsível incomoda menos que um que pula a cada
  ferramenta, e o usuário pode recolhê-lo com um clique a qualquer momento
  (coisa que antes o `disabled` impedia durante o turno). A alternativa
  considerada — recolher **uma vez só, de forma irreversível**, quando a
  resposta começa — atenderia as duas specs, mas contraria o requisito
  event-driven desta ("recolher quando o turno termina") e some com o
  raciocínio antes de o turno acabar. Fica registrada caso o owner prefira.

- **A duração de parede saiu junto (item 1).** O `setInterval` de 200 ms
  alimentava um `elapsed` que nunca chegava à tela: durante o voo o cabeçalho
  é só o shimmer, e no fim do turno a duração vem dos timestamps persistidos.
  Com bloco e rótulo dirigidos por `live`, o intervalo passaria a rodar o turno
  inteiro sem nada a mostrar, então `thinkingInFlight`/`resolveThinkingTiming`
  deram lugar a `thinkingDuration(segments, live, startedAt)`.

- **O controle manual vence o recolhimento do fim do turno (item 1).** Os dois
  requisitos event-driven se cruzam quando o usuário deixa o bloco aberto de
  propósito: "recolher ao fim do turno" mandaria fechar, "parar de controlar
  depois do clique" mandaria não mexer. Prevalece a regra específica — fechar
  por baixo de quem abriu para ler é o mesmo salto que a spec veio remover. O
  turno seguinte devolve o controle à automação, que é o alcance do "até o fim
  daquele turno". Implementado em
  `apps/web/src/client/lib/thinking-disclosure.ts`.

- **Item 2 resolvido por delegação, não por prop em cada botão.** O app tem
  79 `<button>` cru, 85 `<Button>` e uma pilha de `NavLink`/`Link`/itens de
  menu Radix. Amarrar a deixa ao componente `Button` deixaria de fora
  justamente a sidebar, que usa `NavLink` — e amarrar em cada chamada seria
  uma mudança de centenas de pontos que envelhece no primeiro botão novo que
  alguém escrever. O ícone se marca com `data-icon-cue` e um par único de
  ouvintes `pointerover`/`pointerout` no documento acha o controle subindo o
  DOM (`createHoverScope`, em `lib/icon-cue.ts`). Uma trava por ícone
  (`createHoverCueLatch`) conta as duas fontes — glifo e controle — para o
  ponteiro atravessar de uma para a outra sem reiniciar nem derrubar a
  animação.
- **A deixa por controle alcança glifo de metadado, e isso é aceito.** A linha
  da biblioteca (`transcricoes.tsx:1133`) é um `<Link>` inteiro com seis ícones
  de 10px dentro — origem, pasta e até quatro tags — que são informação, não
  afordância. Passar o mouse na linha anima os seis de uma vez. Conferido em
  browser: a 10px o gesto fica no limiar da percepção, e nenhum critério da
  spec distingue "ícone do controle" de "ícone dentro do controle" sem inventar
  heurística (limite de quantidade, tamanho mínimo) dentro do arquivo mais
  perigoso do app. Fica como está, e a saída é barata se incomodar:
  `isAnimated={false}` no glifo decorativo o tira das DUAS áreas sensíveis, sem
  tocar na delegação.
- **Toque não recebe a deixa.** O browser emite a sequência de compatibilidade
  do mouse no tap e só emite a saída no toque seguinte em outro elemento — o
  ícone ficaria parado na pose animada até lá. Com o alvo passando do glifo de
  18px para o controle inteiro, praticamente todo toque cairia nisso, então a
  delegação ignora `pointerType === 'touch'`. Caneta continua valendo.
- **Meio-termo não respondido no item 4.** Foi oferecida ao owner a opção de
  indicador semi-visível em repouso e opaco no hover; ele não respondeu.
  Segue-se o pedido literal (some junto com as ações) até indicação
  contrária.
- ~~O `setInterval` de 200ms em `chat.tsx:335`…~~ **Resolvido junto do item 1**
  (ver decisão "A duração de parede saiu junto", acima): deixou de ser
  oportunidade e virou consequência, porque com o gatilho estável o intervalo
  rodaria o turno inteiro sem nada a exibir.
