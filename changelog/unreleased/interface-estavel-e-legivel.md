---
tipo: fix
titulo: Interface mais estável, legível e consistente
---

A navegação entre telas deixa de exibir conteúdo da rota anterior ou saltar o
scroll durante a troca. O carregamento preserva o shell da aplicação, e as
páginas operacionais passam a aproveitar melhor a largura disponível sem
alongar excessivamente textos de leitura.

No mobile, o menu lateral mantém animação, foco, sombra e bloqueio da página
sincronizados até o fim do gesto. O editor de notas reorganiza título, status e
ações para manter Preview e Salvar acessíveis em telas estreitas; `/` e `/chat`
também passam a compartilhar o mesmo comportamento de navegação.

O Grafo ganha contraste confiável ao passar o mouse ou selecionar nós, resumo
sem marcadores Markdown crus e preparação antecipada do modo 3D. No chat, a
timeline mostra estados operacionais seguros, preserva durações concluídas e
oferece mais espaço para tabelas e outros dados estruturados.

O aviso de nova versão ganhou uma área maior e rolável com cabeçalho e ações
sempre visíveis. Detalhes da fila e a página de novidades receberam correções
de hierarquia e navegação.

Por fim, instruções e comentários indevidos deixam de virar tags. Rótulos
históricos conhecidos são saneados no deploy e conteúdos que ficarem sem tags
voltam automaticamente ao processamento idempotente.
