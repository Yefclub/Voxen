# 129 — Tema Voxen e animação de ícones

## Contexto

Dois ajustes de identidade e polimento, ambos transversais à interface:

1. **Tema padrão sem nome próprio.** O tema padrão da aplicação se chama
   `linear` — nome herdado da referência visual que inspirou a paleta, não
   do produto. Deve continuar sendo o padrão, mas passar a se chamar
   "Voxen" para o usuário. Hoje o identificador aparece em
   `apps/web/src/client/lib/theme.ts` (`APP_THEMES`, `DEFAULT_THEME`,
   `DARK_THEMES`), no CSS (`[data-theme='linear']` em
   `apps/web/src/client/index.css`), na extensão (`apps/extension/theme.css`,
   `theme-init.js`) e no valor persistido por usuário.
2. **Ícones sem animação de entrada.** Ao abrir uma página ou ao
   abrir/fechar a sidebar, os ícones aparecem estáticos. O comportamento
   desejado é que executem sua animação nesses momentos.

## Glossário

- **Rótulo do tema**: o nome exibido ao usuário na seleção de tema.
- **Identificador do tema**: o valor técnico persistido e usado em
  `data-theme`.

## Requisitos

### Ubiquitous

- The system shall apresentar ao usuário o tema padrão com o rótulo
  "Voxen".
- The system shall manter o tema padrão como o tema aplicado quando o
  usuário nunca escolheu outro.
- The system shall respeitar `prefers-reduced-motion` em toda animação de
  ícone introduzida.

### Event-driven

- When o usuário abre uma página, the system shall executar a animação dos
  ícones dessa página.
- When a sidebar é aberta ou fechada, the system shall executar a animação
  dos ícones envolvidos.

### Unwanted behavior

- If um usuário já tem o tema padrão persistido sob o identificador
  anterior, then the system shall continuar aplicando o mesmo tema após a
  renomeação — sem reverter a escolha do usuário nem exibir tema errado.

## Critérios de Aceite

- [ ] Seleção de tema mostra "Voxen" no lugar do rótulo anterior, e segue
      sendo o padrão.
- [ ] Usuário com o tema padrão já persistido continua vendo o mesmo tema
      após a mudança (sem regressão de dado existente).
- [ ] A extensão continua aplicando o tema corretamente (ela espelha os
      identificadores de tema do app — ver spec 122).
- [ ] Ícones animam ao abrir página e ao abrir/fechar a sidebar.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Testes cobrindo a compatibilidade do identificador persistido.

## Fora de Escopo

- Mudança de paleta ou criação de tema novo — é renomeação, não redesenho.
- Animação de outros elementos além de ícones.
- Renomear os demais temas (`zinc`, `emerald`, `light`).
- Deixa no modo "notas" da sidebar (`NotasModeBody`). Abrir/fechar a navegação
  em `/notas` não pontua nada: ali o painel é uma árvore de notas do usuário,
  não a lista fixa de destinos, e varrer ícones de uma árvore que muda de
  tamanho é ruído, não pontuação.

## Decisões tomadas na implementação

- **Só o rótulo muda; o identificador segue `linear`.** O nome exibido vive
  em `theme.linear` no i18n (PT-BR e EN) e virou "Voxen". `APP_THEMES`,
  `DEFAULT_THEME`, `[data-theme='linear']`, a coluna `theme` da conta e o
  espelho da extensão ficam intactos. Nenhuma migração de dado, nenhum
  usuário perde o tema, e a extensão não precisou ser tocada. A separação
  entre identificador e rótulo está documentada em `lib/theme.ts`.

- **As deixas de animação de ícone são duas, e só duas.** O gesto foi
  calibrado em `lib/icon-cue.ts` (duração 0.55s contra o padrão 1s do
  pacote, stagger de 45ms, atraso inicial curto):
  - **Abrir página** → anima apenas o ícone do `PageHeader`, o que nomeia a
    página, 120ms após a montagem. Um ícone por página; animar a tela
    inteira a cada rota vira ruído.
  - **Abrir/fechar navegação** → varre em cascata os ícones de navegação do
    painel (expandido) ou do rail (colapsado) no desktop, e do drawer ao
    abrir no mobile, 160ms após o início da transição do painel. Dispara só
    na troca de estado, não no primeiro carregamento — aí quem pontua é o
    cabeçalho da página.

  As deixas **se sobrepõem de propósito** às transições de container: 120ms e
  160ms são menores que a subida do `PageShell` (0.38s) e que o spring da
  sidebar, então o ícone começa a se desenhar com o container ainda em
  movimento. São elementos e propriedades diferentes (o container move `y` e
  `opacity`; o ícone desenha o próprio traço), sem concorrência nem salto de
  layout. Tudo o mais (botões, tabelas, cards) continua estático.

- **O gatilho da navegação é um contador, não "animar ao montar".** A sidebar
  desktop remonta rail e painel a cada toggle, mas o drawer mobile fica
  montado o tempo todo (o gesto de swipe precisa da árvore pronta fora da
  tela). `useIconCueTrigger` produz o contador (a partir de `collapsed` no
  desktop e de `open` no mobile) e `useIconCueSignal` roda a deixa quando o
  número **muda**, o que cobre
  os dois casos, não pontua no primeiro carregamento e não pontua no painel
  que o `AnimatePresence` mantém em cena enquanto sai (ele rerenderiza o
  elemento com as props congeladas da última vez em que esteve presente).
  No mobile só a abertura pontua: fechando, varrer ícones de um painel que
  está saindo seria desperdício.

- **Ícones passaram a expor `ref`** com o handle `startAnimation` /
  `stopAnimation` do `@animateicons/react`. Anexar uma ref faz o pacote
  parar de animar o hover sozinho e delegar aos handlers de mouse, então o
  wrapper em `components/ui/icons.ts` reproduz o hover nativo — anexar a ref
  não custa a animação de hover que já existia.

- **`prefers-reduced-motion`** é barrado em três camadas: o grupo de deixas
  não agenda timers, o wrapper de ícone não chama `startAnimation`, e o
  próprio pacote ignora o comando.

## Como isto é testado

`lib/icon-cue.ts` separa a fila de timers (`createCueQueue`) e o registro de
ícones (`createIconCueController`) do hook React, que virou casca fina. A fila
recebe o agendador por injeção, então `icon-cue.test.ts` roda um relógio falso
e verifica comportamento de verdade — cascata, stagger, cancelamento da deixa
anterior, `dispose` no meio do gesto, movimento reduzido — sem DOM e sem
`setTimeout` remendado.

`components/ui/icons.test.ts` renderiza o wrapper de ícone com
`react-dom/server` e um ícone sonda no lugar do ícone do pacote. Confere o
handle de animação que chega no ícone interno e, escrevendo um handle espião
nessa ref, confere que os handlers de mouse do wrapper realmente chamam
`startAnimation`/`stopAnimation` — esvaziar o corpo dos handlers quebra a
suíte, que é a regressão de hover dos 103 ícones.

`tests/icon-cue-lifecycle.test.tsx` cobre os dois requisitos event-driven com
`react-test-renderer` (já usado por `graph-renderer-lifecycle` e
`transcript-chat-dock` — o repositório testa ciclo de vida de componente sem
DOM assim):

- **Abrir página**: monta o `PageHeader` real com um ícone sonda e verifica que
  o ícone se desenha depois da montagem, não no frame dela.
- **Abrir/fechar navegação**: `useIconCueTrigger` + `useIconCueSignal` reais nas
  duas topologias — a do desktop, em que o painel remonta na troca de estado, e
  a do drawer mobile, em que o corpo nunca desmonta e só a abertura pontua. O
  teste do desktop é o que impede derivar o sinal durante o render: o valor
  novo chegaria já na montagem, o hook não veria mudança e a deixa morreria em
  silêncio.
- **Unmount**: com o agendador injetado em `useIconCueGroup`, o teste afirma
  que a fila fica vazia depois do unmount — remover o `useEffect` de limpeza
  deixa timers pendentes e quebra a suíte.

O gatilho da navegação virou o hook `useIconCueTrigger` justamente para isso:
enquanto era um `useState` + `useEffect` copiado dentro de `Sidebar` e de
`MobileNavDrawer`, não havia como testá-lo sem renderizar a sidebar inteira
(radix-ui e `motion` não sobrevivem ao renderer de teste sem um DOM).

## Limitações conhecidas

- **Rota com parâmetro não redispara a deixa da página.** Navegar de
  `/transcricoes/a` para `/transcricoes/b` reaproveita o mesmo `PageHeader`
  montado, então o ícone do cabeçalho não se desenha de novo. Aceito: a deixa
  é pontuação de entrada de tela, e a tela não entrou.
- **A ligação final da sidebar não é renderizada em teste.** O que os testes
  travam é o mecanismo (`useIconCueTrigger` → `useIconCueSignal` →
  `useIconCueGroup`) e o `PageHeader` real; montar `Sidebar` de verdade
  esbarra no `@radix-ui/react-tooltip`, que entra em loop de atualização sem
  DOM. Sobra uma linha por caller (`useIconCueTrigger(collapsed)` e
  `useIconCueTrigger(open, isOpen)`) coberta só por revisão.
- **O `@animateicons/react` desligar o hover sozinho é premissa verificada no
  browser, não em teste.** A suíte garante que o wrapper chama o handle nos
  handlers de mouse; que o pacote pare de escutar o mouse quando há `ref`
  anexada foi confirmado no browser e está registrado em comentário no código.
- **A extensão espelha os identificadores de tema à mão.** Não há teste
  cruzando `apps/web` com `apps/extension`: ler fonte de outro workspace
  quebra a cada reformatação da extensão. O contrato está documentado em
  `lib/theme.ts` — mudou identificador aqui, atualiza a extensão junto.
