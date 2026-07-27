# Spec 108 — Biblioteca Viva: organização temporal e contexto recuperável

## Contexto

A Biblioteca já permite pastas e tags, porém a organização depende de o usuário lembrar onde cada item foi colocado. Conteúdo recém-capturado, semanas anteriores e itens associados a uma tag não têm uma entrada de navegação única e visível. A Vox também recebe tags e resumo, mas não recebe de forma consistente a pasta e o período de captura que explicam o contexto de trabalho.

Esta melhoria torna a organização parte do fluxo diário: capturar, revisar, localizar e perguntar para a Vox. Ela reutiliza as pastas e tags existentes; não cria uma segunda árvore de arquivos nem altera o conteúdo original.

## Glossário

- **Inbox**: conteúdo ativo sem pasta direta e sem tag associada a pasta; representa item ainda não organizado.
- **Período**: recorte de criação por semana atual, semana anterior ou todo o acervo.
- **Tag visível**: tag retornada com quantidade de conteúdos ativos para permitir filtrar sem digitar uma busca.
- **Contexto de Biblioteca**: título, resumo, tags, pasta e data de captura enviados para a IA antes de leitura integral.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall escopar Inbox, períodos, tags, pastas e resultados de busca ao usuário autenticado.
- The system shall manter as pastas e tags existentes como fontes canônicas de organização, sem duplicar conteúdo.
- The system shall retornar pasta, tags e data de captura nos resultados de recuperação usados pela IA quando esses metadados existirem.

### Event-driven (resposta a evento)

- When o usuário selecionar Inbox, the system shall listar somente conteúdos ativos sem pasta direta e sem tag associada a pasta.
- When o usuário selecionar uma tag visível, the system shall filtrar a Biblioteca por essa tag e preservar os demais filtros ativos.
- When o usuário selecionar semana atual ou anterior, the system shall limitar os resultados ao intervalo semanal correspondente.
- When o usuário combinar busca textual com tag, pasta, Inbox ou período, the system shall aplicar todos os filtros à mesma consulta.

### State-driven (durante um estado)

- While a lista da Biblioteca estiver visível, the system shall apresentar filtros de Inbox, período, pastas e tags com estado ativo inequívoco.
- While uma tag estiver selecionada, the system shall permitir removê-la sem apagar os demais filtros da URL.

### Optional (feature opcional)

- Where existirem mais tags do que o espaço direto comporta, the system shall oferecer a lista completa em um seletor pesquisável.

### Unwanted behavior (condições de erro)

- If uma tag ou pasta não pertencer ao usuário atual, then the system shall não expor nem incluir conteúdo de outro workspace.
- If um parâmetro de período for inválido, then the system shall ignorá-lo e manter o resultado seguro, sem erro interno.

## Critérios de Aceite

- [ ] A API lista tags ativas com contagem apenas do workspace atual.
- [ ] Inbox retorna somente conteúdos ativos ainda não organizados.
- [ ] Filtro de tag, pasta, status e período funciona tanto sem busca quanto com busca FTS.
- [ ] A Biblioteca oferece Inbox, semana atual, semana anterior, pastas e tags visíveis; os filtros são compartilháveis pela URL.
- [ ] Cada linha de conteúdo mantém pasta e tags visíveis e informa em que semana foi capturada.
- [ ] A recuperação progressiva da IA inclui pasta e data de captura sem carregar o conteúdo completo.
- [ ] Testes cobrem isolamento de workspace, composição dos filtros e os novos metadados de recuperação.

## Fora de Escopo

- Projetos/dossiês, conectores externos, automações e sincronização offline.
- Alterar conteúdo, título ou tags automaticamente sem ação explícita do usuário.
- Criar nova migração ou uma taxonomia paralela às pastas e tags existentes.

## Riscos / Decisões pendentes

- Os períodos usam a semana ISO no fuso do navegador para serem compreensíveis na interface; a API recebe limites de data validados em vez de inferir o fuso do servidor.
- O recorte temporal é por data de captura, não por data de publicação da fonte.
