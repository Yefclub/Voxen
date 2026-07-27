# Spec 080 — Cap de chips de pasta na Biblioteca com overflow pesquisável

## Status

Em implementação (2026-07-12).

## Contexto

A Biblioteca lista as pastas do usuário como uma fileira de chips clicáveis, usada para
filtrar o acervo por pasta. Até aqui, a fileira renderizava um chip para cada pasta
existente, sem limite algum, ordenados alfabeticamente.

A geração de tags por IA (spec 075, PR #352) cria automaticamente uma pasta para cada tag
nova atribuída a um conteúdo. Isso faz o número de pastas crescer rapidamente conforme o
acervo é tagueado, e a fileira de chips passou a quebrar em várias linhas — visualmente
poluída e difícil de escanear.

Esta spec define um limite fixo de chips visíveis na fileira, com o excedente acessível por
um controle de overflow pesquisável ("+K mais"), preservando a navegação por pasta em uma
única interação (clique/toque), igual à experiência atual.

## Glossário

- **Chip de pasta**: elemento clicável que filtra o acervo por uma pasta específica,
  mostrando nome e quantidade de conteúdos daquela pasta.
- **Chips fixos**: os dois chips especiais sempre presentes na fileira — "Todas" (remove o
  filtro de pasta) e "Sem pasta" (filtra conteúdos sem pasta atribuída). Não contam como
  pasta real e ficam fora do limite visível.
- **Limite visível**: quantidade máxima de chips de pasta real exibidos diretamente na
  fileira, antes de precisar do controle de overflow.
- **Overflow**: conjunto de pastas que excedem o limite visível, acessível via um chip
  adicional ao final da fileira.

## Requisitos (EARS)

### Ubiquitous

- O sistema DEVE exibir os chips fixos "Todas" e "Sem pasta" sempre visíveis na fileira,
  independentemente da quantidade de pastas do usuário.
- O sistema DEVE ordenar as pastas alfabeticamente antes de decidir quais entram no limite
  visível e quais vão para o overflow.
- O sistema DEVE manter, para cada pasta — esteja ela visível na fileira ou dentro do
  overflow —, a mesma informação hoje exibida no chip: nome e quantidade de conteúdos.

### Event-driven

- Quando o número de pastas exceder o limite visível, o sistema DEVE exibir um chip
  adicional ao final da fileira indicando quantas pastas estão fora dela (ex.: "+K mais").
- Quando o usuário clicar/tocar no chip de "mais", o sistema DEVE abrir um controle de busca
  listando **todas** as pastas do usuário (não apenas as que excedem o limite visível).
- Quando o usuário digitar num campo de busca dentro do controle de overflow, o sistema DEVE
  filtrar a lista exibida por nome da pasta, sem diferenciar maiúsculas/minúsculas, em tempo
  real (sem precisar de confirmação/Enter).
- Quando o usuário selecionar uma pasta dentro do controle de overflow, o sistema DEVE
  aplicar o filtro de pasta (efeito equivalente a clicar no chip dessa pasta na fileira) e
  fechar o controle de overflow.
- Quando o número de pastas for menor ou igual ao limite visível, o sistema NÃO DEVE exibir
  o chip de "mais".

### State-driven

- Enquanto o controle de overflow estiver aberto, o sistema DEVE permitir fechá-lo sem
  selecionar nenhuma pasta.
- Enquanto a pasta ativa (selecionada no filtro atual) estiver fora do limite visível, o
  sistema DEVE manter uma forma de indicar visualmente, na própria fileira, que há uma
  seleção ativa escondida no overflow.

### Optional

- Onde a busca dentro do controle de overflow não encontrar nenhuma pasta correspondente, o
  sistema DEVE exibir uma indicação clara de "nenhuma pasta encontrada", em vez de uma lista
  vazia sem explicação.

### Unwanted behavior

- Se a lista de pastas do usuário estiver vazia, então o sistema NÃO DEVE exibir o chip de
  "mais" nem o controle de overflow.
- Se o número de pastas for exatamente igual ao limite visível, então o sistema NÃO DEVE
  tratar isso como excedente (nenhum chip de "mais" deve aparecer).

## Critérios de Aceite

- [ ] Com menos pastas que o limite visível, todas aparecem como chip direto na fileira;
      nenhum chip de "mais" é exibido.
- [ ] Com exatamente o limite visível de pastas, todas aparecem como chip direto; nenhum
      chip de "mais" é exibido.
- [ ] Com mais pastas que o limite visível, só as primeiras (ordem alfabética) aparecem como
      chip direto; o chip de "mais" mostra a contagem correta do restante (K).
- [ ] Lista de pastas vazia não produz chip de "mais" nem controle de overflow.
- [ ] Clicar no chip de "mais" abre a lista completa de pastas com campo de busca.
- [ ] Digitar no campo de busca filtra a lista por nome, sem diferenciar
      maiúsculas/minúsculas, e sem alterar a ordem relativa das pastas restantes.
- [ ] Busca sem correspondência exibe mensagem de "nenhuma pasta encontrada" em vez de lista
      vazia silenciosa.
- [ ] Selecionar uma pasta na lista de overflow aplica o mesmo filtro que clicar num chip
      normal e fecha o controle.
- [ ] Chips fixos ("Todas", "Sem pasta") continuam sempre visíveis e fora da contagem do
      limite visível.
- [ ] Contagem de conteúdos por pasta, criação de pasta nova e demais comportamentos já
      existentes da seção de pastas continuam funcionando sem alteração.

## Fora de Escopo

- Mudar a ordenação das pastas (continua alfabética).
- Paginação ou busca no backend — a lista de pastas já é carregada inteira de uma vez pelo
  endpoint existente; o cap e a busca do overflow são inteiramente client-side.
- Reorganizar/agrupar pastas hierarquicamente (subpastas).
- Limite visível diferente por tamanho de tela (responsivo) — fica como possível iteração
  futura caso o valor fixo escolhido não se comporte bem em alguma largura específica.
- Qualquer outro comportamento da página de Biblioteca fora da fileira de navegação de
  pastas (busca de conteúdo, status, paginação de resultados, ações de IA em lote etc.).

## Riscos / Decisões pendentes

- Limite visível escolhido: 6 chips de pasta reais (fora dos 2 chips fixos). Valor fixo,
  igual em qualquer largura de tela — não há cap diferente por breakpoint nesta primeira
  versão. Pode precisar de ajuste depois de uso real com acervos grandes.
- A spec não define comportamento específico de navegação por teclado dentro do controle de
  overflow além do coberto pelos critérios de aceite; a implementação segue os padrões de
  acessibilidade (foco, fechar com Esc, fechar ao clicar fora) já usados nos demais controles
  interativos flutuantes da aplicação.
