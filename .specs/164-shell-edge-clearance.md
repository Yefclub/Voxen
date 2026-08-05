# Spec 164 — Respiro nas bordas do shell

## Contexto

Após a compactação do shell, páginas desktop passaram a iniciar sem respiro em
relação ao limite superior da aplicação. O cabeçalho flutuante e as setas da
barra de rolagem também ficaram visualmente próximos das bordas arredondadas.
Esta spec restaura a separação visual sem reintroduzir uma faixa estrutural alta
ou alterar a navegação móvel.

## Requisitos

### Ubiquitous

- The system shall iniciar o conteúdo das páginas convencionais e de
  administração no desktop com 20 px de respiro acima do primeiro elemento da
  página.
- The system shall manter o cabeçalho flutuante desktop com pelo menos 20 px
  de distância efetiva da barra de rolagem, nos modos clássico e focado.
- The system shall manter a espessura da barra de rolagem em 8 px e exibir
  somente os controles direcionais de início e fim lógico.
- The system shall reservar 16 px no eixo de rolagem para cada controle
  direcional visível, centralizando-o fora dos cantos arredondados.

### State-driven

- While a interface móvel estiver ativa, the system shall preservar os
  deslocamentos atuais de safe area e os alvos de toque de 40 px do cabeçalho.
- While uma rota ocupar a tela integralmente, the system shall preservar seu
  gerenciamento próprio de layout sem forçar o espaçamento de página padrão.

### Unwanted behavior

- If uma alteração de respiro tentar reintroduzir uma reserva desktop de 5 rem
  para o cabeçalho flutuante, then the system shall rejeitar esse contrato nos
  testes de layout.

## Critérios de Aceite

- [x] Páginas que usam o shell padrão e administrativo iniciam 20 px abaixo do
      topo no desktop.
- [x] O cabeçalho desktop fica ao menos 20 px afastado da barra de
      rolagem, nos modos clássico e focado.
- [x] A barra mantém 8 px de largura e apenas as setas de início/fim.
- [x] Cada seta vertical recebe 16 px de altura e cada seta horizontal recebe
      16 px de largura, com o glifo centralizado.
- [x] O layout móvel não perde safe area, navegação nem alvos de 40 px.
- [x] Testes de contrato, lint e typecheck passam.

## Fora de Escopo

- Alterar a largura da sidebar, a arquitetura da navegação ou o design do
  cabeçalho.
- Habilitar novamente a página de Artefatos.
- Redesenhar a barra de rolagem para navegadores sem pseudo-elementos WebKit.

## Riscos / Decisões pendentes

- Os pseudo-elementos de scrollbar são implementados pelos navegadores; o
  contrato garante a geometria CSS e a validação visual cobre o Chromium.
