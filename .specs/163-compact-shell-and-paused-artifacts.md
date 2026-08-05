# Spec 163 — Shell compacto e artefatos pausados

## Contexto

A interface focada mantém o cabeçalho como chrome flutuante, mas o layout ainda reserva uma faixa vertical completa no desktop. No chat, a ancoragem programática de mensagens também pode posicionar a primeira mensagem sob esse chrome em telas móveis. A barra de rolagem ocupa espaço excessivo e exibe controles redundantes nas duas extremidades.

A área de artefatos deve permanecer implementada para retomada futura, porém não deve ser apresentada como funcionalidade disponível enquanto estiver pausada.

## Glossário

- **Chrome flutuante**: controles globais posicionados sobre o conteúdo sem reservar uma linha completa do layout.
- **Início lógico**: extremidade superior de uma barra vertical ou esquerda de uma barra horizontal.
- **Fim lógico**: extremidade inferior de uma barra vertical ou direita de uma barra horizontal.
- **Rota pausada**: rota preservada no código, mas indisponível na navegação e redirecionada para uma área ativa.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall limitar a espessura das barras de rolagem para ponteiro preciso a 8 px.
- The system shall exibir somente o controle de decremento no início lógico e somente o controle de incremento no fim lógico de cada barra de rolagem.
- The system shall manter os controles móveis do cabeçalho com alvo de toque de 40 × 40 px.
- The system shall manter o código e os dados de artefatos disponíveis para reativação futura.

### Event-driven (resposta a evento)

- When um usuário acessar `/artefatos` diretamente, the system shall redirecioná-lo para `/` sem carregar a página pausada.
- When o chat ancorar uma mensagem enviada em viewport móvel, the system shall posicionar o topo da mensagem pelo menos 60 px abaixo do topo útil do chat.

### State-driven (durante um estado)

- While a página de artefatos estiver pausada, the system shall omitir `/artefatos` de todas as navegações derivadas da lista canônica de destinos.
- While a aplicação estiver em viewport desktop, the system shall permitir que o conteúdo comece no topo do painel sem reservar uma faixa vertical para o chrome flutuante.
- While a aplicação estiver em viewport desktop, the system shall renderizar os controles do cabeçalho com 32 × 32 px e um contêiner mais compacto que o atual.
- While o chat estiver em viewport móvel sem rolagem inicial, the system shall manter a primeira mensagem abaixo do chrome flutuante.

### Optional (feature opcional)

- Where o tema claro estiver ativo, the system shall manter as setas da barra de rolagem legíveis com a mesma posição e quantidade do tema escuro.

### Unwanted behavior (condições de erro)

- If o navegador criar posições redundantes de botão para uma barra de rolagem, then the system shall ocultar todas as posições que não sejam o decremento inicial ou o incremento final.

## Critérios de Aceite

- [x] A barra de rolagem desktop mede 8 px e possui uma única seta para cima no topo e uma única seta para baixo no rodapé.
- [x] Barras horizontais, quando existentes, possuem somente a seta esquerda no início e a direita no fim.
- [x] `/artefatos` não aparece na sidebar nem no drawer móvel, e o acesso direto redireciona para `/`.
- [x] A implementação interna e as APIs de artefatos não são removidas.
- [x] O conteúdo desktop não possui o espaço superior de 5 rem antes reservado ao cabeçalho.
- [x] O cabeçalho desktop usa controles de 32 × 32 px e padding reduzido.
- [x] Os controles móveis continuam com alvo de 40 × 40 px.
- [x] A primeira mensagem e mensagens ancoradas no chat móvel não ficam sob o cabeçalho.
- [x] A ancoragem desktop mantém o respiro atual de 12 px.
- [x] Testes automatizados cobrem scrollbar, rota pausada, navegação, offsets do shell e ancoragem responsiva.
- [x] A interface é verificada em desktop e smartphone após o build local.

## Fora de Escopo

- Remover arquivos, APIs, tabelas ou dados relacionados a artefatos.
- Redesenhar a página de artefatos.
- Alterar o conjunto de ações do cabeçalho.
- Alterar o comportamento de rolagem em dispositivos de toque sem ponteiro preciso.

## Riscos / Decisões pendentes

- Os pseudo-elementos de scrollbar são específicos de navegadores baseados em WebKit/Blink; navegadores sem esse suporte mantêm seu comportamento nativo.
- O chrome permanece sobreposto no canto superior direito por definição; páginas devem considerar essa área como flutuante, não como uma linha reservada.
- Escopo aprovado pelo owner em 2026-08-04 com os requisitos desta solicitação.
