# Spec 072 — Home alinhada à Biblioteca e itens selecionáveis

## Contexto

A Home é a superfície principal para incluir conteúdos e acompanhar o processamento, mas sua hierarquia visual é mais expansiva que a Biblioteca. Além disso, o acesso a um item processado depende de um botão pequeno, em vez de permitir selecionar a linha inteira. A Home deve manter os fluxos de ingestão e acompanhamento existentes, adotando a linguagem compacta e navegável já usada na Biblioteca.

## Glossário

- **Item da fila**: uma solicitação de ingestão mostrada na Home, em processamento ou concluída.
- **Destino do item**: a transcrição criada quando o processamento concluiu, ou o detalhe do job enquanto não houver transcrição.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall manter na Home os fluxos existentes de inclusão por URL, upload e arrastar-e-soltar.
- The system shall usar na Home a mesma hierarquia compacta da Biblioteca para cabeçalho, espaçamento, superfícies e linhas de conteúdo.
- The system shall expor cada item da fila como um único alvo navegável, com indicador visual de foco por teclado.

### Event-driven (resposta a evento)

- When o usuário seleciona um item concluído que possui transcrição, the system shall navegar para a respectiva página de transcrição.
- When o usuário seleciona um item sem transcrição, the system shall navegar para o detalhe do job.

### State-driven (durante um estado)

- While um item está em processamento, the system shall continuar exibindo seu estado e progresso em tempo real dentro do alvo selecionável.
- While a fila está carregando, vazia ou indisponível, the system shall preservar os estados de carregamento, vazio e erro já existentes.

### Optional (feature opcional)

- Where a transcrição concluída possuir preview, the system shall exibi-lo sem mudar a área clicável do item.

### Unwanted behavior (condições de erro)

- If um item não possuir transcrição associada, then the system shall not produzir uma URL de transcrição inválida.

## Critérios de Aceite

- [ ] A Home mantém inclusão por URL, upload, arrastar-e-soltar e paginação da fila.
- [ ] O cabeçalho, largura e lista da Home seguem a linguagem visual compacta da Biblioteca.
- [ ] Um item concluído abre a transcrição associada ao clicar ou navegar por teclado.
- [ ] Um item pendente, em execução, com falha ou cancelado abre o detalhe do job.
- [ ] Cada item navegável possui foco visível e um nome acessível.
- [ ] Estados de progresso, erro, carregamento e fila vazia permanecem disponíveis.
- [ ] Testes unitários cobrem a escolha do destino do item.

## Fora de Escopo

- Alterar o pipeline de ingestão, SSE, APIs ou persistência de jobs.
- Alterar filtros, organização ou paginação da Biblioteca.
- Adicionar funcionalidades do chat.

## Riscos / Decisões pendentes

- A validação visual automatizada depende de um navegador local disponível; o ambiente atual não expõe nenhum navegador ao controle de testes.
