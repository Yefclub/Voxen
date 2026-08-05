---
tipo: feat
titulo: Voxen 0.14.1 — interface refinada e busca conectada
---

## Navegação focada mais integrada

A interface focada ganhou uma composição mais coesa: os controles da barra
recolhida ficam centralizados, o painel de fontes passa a fazer parte do fundo
do espaço de trabalho e a conversa se retrai suavemente quando as evidências são
abertas. O cabeçalho flutuante acompanha essa transição sem cobrir o conteúdo.

O espaçamento nas bordas, a altura do cabeçalho e as barras de rolagem também
foram refinados. No desktop, os controles direcionais respeitam os cantos
arredondados; no celular, a primeira mensagem permanece visível abaixo dos
controles. A área de Artefatos fica temporariamente fora da navegação enquanto
seu próximo ciclo de produto é preparado.

## Conta pessoal consistente e separada da administração

Perfil e segurança, contas de plataforma e acesso MCP agora compartilham a mesma
navegação, hierarquia visual e largura de conteúdo das demais páginas. Isso
reforça a separação entre escolhas particulares de cada pessoa e configurações
globais reservadas aos administradores da instância.

## Busca da biblioteca apoiada pelo grafo

A busca das transcrições ocupa uma posição mais fácil de encontrar e passa a
considerar conceitos relacionados já extraídos no grafo, além dos campos
textuais tradicionais. Os sinais adicionais têm peso controlado, ignoram
consultas curtas e continuam estritamente limitados à base do usuário atual.

## Raciocínio do chat com Markdown

O bloco de raciocínio agora apresenta títulos, listas, ênfases e código em
Markdown com a mesma sanitização aplicada às respostas. Textos estruturados
deixam de aparecer como marcação crua sem ampliar a superfície de conteúdo HTML.

## Publicação completa no Easypanel

Releases estáveis agora publicam também a imagem combinada que reúne web, chat e
worker. As tags da versão e `latest` permanecem alinhadas, e uma execução
interrompida pode ser retomada sem recriar a tag da release.
