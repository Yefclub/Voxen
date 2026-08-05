# Spec 168 — Busca da biblioteca apoiada pelo grafo

## Contexto

A busca da biblioteca fica isolada entre o formulário de ingestão e os filtros, sem explicar seu alcance. No servidor, ela encontra texto integral e tags, mas ignora conceitos extraídos pelo Brain que já possuem evidência ligada a um conteúdo.

## Requisitos

### R1 — Descoberta em posição prioritária

- **Quando** a biblioteca for aberta, **então** a busca deve aparecer antes do formulário de ingestão em uma superfície própria.
- **Quando** o campo for exibido, **então** deve explicar que pesquisa trechos, tags e conceitos relacionados.
- **Quando** a tela for estreita, **então** o campo e sua descrição devem permanecer legíveis e ocupar a largura disponível.

### R2 — Expansão pelo Brain

- **Quando** a consulta corresponder ao rótulo ou descrição de um nó ativo do Brain com evidência de uma transcrição, **então** essa transcrição deve ser incluída mesmo sem correspondência literal no texto.
- **Quando** uma correspondência vier do Brain, **então** ela deve receber um reforço de ranking e uma indicação visual no resultado.
- **Quando** filtros de status, pasta, tag ou período estiverem ativos, **então** eles devem continuar aplicados aos resultados expandidos.

### R3 — Isolamento

- **Quando** o Brain for consultado, **então** nó, evidência e transcrição devem pertencer ao `userId` autenticado.
- **Quando** outro usuário possuir um conceito igual, **então** seu conteúdo não deve aparecer nem afetar a contagem.

## Aceite

- [x] A busca antecede a ingestão e possui título e descrição.
- [x] FTS e tags continuam funcionando.
- [x] Conceitos comprovadamente ligados por `BrainSource` ampliam o conjunto.
- [x] O ranking recebe reforço sem substituir o ranking textual.
- [x] Resultados do grafo são identificados na interface.
- [x] Todas as junções do Brain repetem o escopo do usuário.
