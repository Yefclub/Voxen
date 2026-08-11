# Spec 190 — Filtros e paginação navegável da Biblioteca

## Contexto

A Biblioteca já oferece busca textual e filtros de organização, mas esses controles estão
dispersos, a descoberta de pastas e tags depende de menus de overflow e a lista usa o padrão
“carregar mais”. Busca e posição da página também não são representadas na URL, impedindo
compartilhamento, recarga e navegação confiável pelo histórico do navegador.

Esta evolução torna o estado da listagem explícito e navegável sem alterar o modelo de dados
da base de conhecimento ou o mecanismo de busca textual e por grafo.

## Glossário

- **Estado da Biblioteca**: combinação de busca, página, período, status, inbox, pasta e tag.
- **Página válida**: inteiro positivo dentro do total de páginas disponível para o resultado.
- **Filtro de organização**: seleção exclusiva entre toda a biblioteca, inbox, sem pasta ou uma
  pasta específica.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall representar busca, página e todos os filtros aplicados em parâmetros de URL.
- The system shall preservar o isolamento por usuário ao descobrir e aplicar pastas e tags.
- The system shall mostrar no máximo 24 conteúdos por página e informar o total de resultados.
- The system shall oferecer controles pesquisáveis e acessíveis para selecionar pastas e tags.
- The system shall oferecer paginação numerada com indicação da página atual.

### Event-driven (resposta a evento)

- When o usuário alterar busca, período, status, inbox, pasta ou tag, the system shall voltar à
  primeira página e atualizar a URL sem recarregar a aplicação.
- When o usuário selecionar um número de página, anterior ou próxima, the system shall buscar
  somente aquela página e preservar os filtros atuais na URL.
- When o usuário usar voltar ou avançar no navegador, the system shall restaurar a busca, os
  filtros e a página descritos pela URL.
- When o usuário pesquisar no seletor de tags ou pastas, the system shall mostrar apenas opções
  correspondentes sem alterar a lista até que uma opção seja escolhida.
- When uma tag selecionada não estiver entre as opções iniciais, the system shall continuar
  mostrando seu nome como filtro ativo.

### State-driven (durante um estado)

- While uma página filtrada estiver sendo carregada, the system shall indicar carregamento e
  evitar misturar conteúdos da página anterior com a nova.
- While houver filtros ativos, the system shall oferecer uma ação única para limpar todos os
  filtros e retornar à primeira página.

### Optional (feature opcional)

- Where o total de resultados tiver mais de uma página, the system shall mostrar números
  vizinhos à página atual e reticências para intervalos omitidos.

### Unwanted behavior (condições de erro)

- If o parâmetro `page` for ausente, inválido ou menor que um, then the system shall usar a
  primeira página.
- If a página solicitada exceder o total após a resposta filtrada, then the system shall navegar
  para a última página válida preservando os filtros.
- If a pasta ou tag não pertencer ao usuário autenticado, then the system shall retornar uma
  lista vazia sem revelar metadados de outro usuário.

## Critérios de Aceite

- [x] Busca textual é restaurada pela URL e participa do histórico do navegador.
- [x] Período, status, inbox, pasta, tag e página permanecem na URL em formato canônico.
- [x] Pastas e tags podem ser localizadas por nome em controles visíveis e pesquisáveis.
- [x] A tag ativa mantém seu nome visível mesmo fora da primeira página de descoberta.
- [x] Alterar qualquer filtro volta para a página 1.
- [x] A lista exibe até 24 itens da página escolhida, sem acumular páginas anteriores.
- [x] Paginação numerada funciona com anterior, próxima e intervalos extensos.
- [x] URL com página inválida ou acima do total é normalizada com segurança.
- [x] Layout funciona em viewport desktop e smartphone, com foco e rótulos acessíveis.
- [x] Testes automatizados cobrem normalização da URL, reset de página e janela de paginação.

## Fora de Escopo

- Alterar o algoritmo de relevância textual ou do grafo.
- Permitir múltiplas pastas ou múltiplas tags simultâneas.
- Criar novos tipos de organização ou modificar o schema Prisma.
- Paginação por cursor nos clientes MCP.

## Riscos / Decisões pendentes

- A paginação permanece baseada em offset porque a API atual já oferece total exato e o produto
  precisa de números de página; migrar para cursor impediria saltos numéricos diretos.
- Mudanças concorrentes na Biblioteca podem deslocar itens entre páginas, comportamento esperado
  para uma listagem ordenada por data sem snapshot persistente.
