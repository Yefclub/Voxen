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
      alterna entre aberto e fechado durante o turno.
- [x] Clicar no bloco durante o turno impede que ele volte a se mover
      sozinho até o turno acabar.
- [ ] Passar o ponteiro sobre um botão anima o ícone dentro dele; passar
      sobre o ícone continua animando.
- [ ] Sidebar colapsada oferece novidades e sair, com rótulo acessível.
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
- **O controle manual vence o recolhimento do fim do turno (item 1).** Os dois
  requisitos event-driven se cruzam quando o usuário deixa o bloco aberto de
  propósito: "recolher ao fim do turno" mandaria fechar, "parar de controlar
  depois do clique" mandaria não mexer. Prevalece a regra específica — fechar
  por baixo de quem abriu para ler é o mesmo salto que a spec veio remover. O
  turno seguinte devolve o controle à automação, que é o alcance do "até o fim
  daquele turno". Implementado em
  `apps/web/src/client/lib/thinking-disclosure.ts`.

- **Meio-termo não respondido no item 4.** Foi oferecida ao owner a opção de
  indicador semi-visível em repouso e opaco no hover; ele não respondeu.
  Segue-se o pedido literal (some junto com as ações) até indicação
  contrária.
- O `setInterval` de 200ms em `chat.tsx:335` roda o turno inteiro para
  atualizar `elapsed`, que durante o voo não é exibido — só o shimmer
  aparece. Oportunidade adjacente, não obrigação desta spec.
