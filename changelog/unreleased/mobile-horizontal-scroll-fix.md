---
tipo: fix
titulo: Chat e outras telas não arrastam mais na horizontal no celular
---

Em telas menores, algumas áreas do app podiam ser arrastadas para os lados —
principalmente o chat, quando o resumo de uma ferramenta, um erro ou a própria
mensagem colada continha um link, token ou ID longo sem espaços, que esticava o
balão além da largura da tela em vez de quebrar linha.

Corrigimos os pontos de origem (detalhe de ferramenta e bolha de mensagem do
chat, mensagem de erro de execução de automações, corpo de notas de release no
modal de atualização e em "Novidades") e reforçamos como cinto de segurança os
principais containers de rolagem do app — conteúdo das páginas, modais e
diálogos — para nunca abrirem rolagem lateral, mesmo diante de um texto sem
quebra.
