# Spec 088 — Navegação mobile compacta

## Contexto

O chrome flutuante do aplicativo reutiliza no mobile as mesmas dimensões do
desktop. Em telas menores, o topbar, seus controles e o botão que abre a
sidebar consomem área visual desproporcional e exigem uma reserva vertical
maior que a necessária.

Esta mudança compacta somente o chrome mobile. As dimensões e o espaçamento do
desktop permanecem iguais aos atuais.

## Glossário

- **Chrome mobile**: topbar flutuante, controles contidos nele e botão que abre
  a navegação lateral em viewports menores que 768 px.
- **Desktop**: viewport a partir de 768 px, correspondente ao breakpoint `md`.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall preservar no desktop as dimensões, o espaçamento e o
  posicionamento atuais do topbar e de seus controles.
- The system shall manter alvos interativos mobile com no mínimo 32 px de
  largura e altura.

### State-driven (durante um estado)

- While a viewport for menor que 768 px, the system shall renderizar o topbar
  com controles, avatar, espaçamentos e afastamentos das bordas mais compactos
  que no desktop.
- While a viewport for menor que 768 px, the system shall renderizar o botão de
  abrir a sidebar com 32 px, afastamento de 8 px das bordas superior e esquerda
  após a safe area e sombra discreta.
- While a viewport for menor que 768 px, the system shall reservar 64 px mais a
  safe area superior antes do conteúdo em rotas que exibem o chrome global.

### Unwanted behavior (condições de erro)

- If o topbar exibir os controles específicos do chat no mobile, then the
  system shall manter o indicador textual de resposta oculto para não ampliar
  o chrome.

## Critérios de Aceite

- [x] Topbar mobile usa afastamento de 8 px, controles/avatar de 32 px e
      espaçamento interno reduzido.
- [x] Topbar desktop mantém afastamento de 16 px, controles/avatar de 36 px e
      os espaçamentos anteriores.
- [x] Botão de abrir a sidebar mobile usa 32 px, ícone de 16 px e sombra leve.
- [x] Conteúdo não full-bleed reserva 64 px no mobile e 80 px no desktop, além
      da safe area superior.
- [x] Indicador textual de streaming aparece somente a partir do breakpoint
      desktop.
- [x] Validações de lint, formatação, tipos e testes permitidas ficam verdes.

## Fora de Escopo

- Alterações na sidebar desktop, no drawer mobile ou nos itens da bottom-nav.
- Redimensionamento do botão de voltar das subpáginas mobile.
- Alterações funcionais de navegação, chat, tema ou menu de usuário.
- Verificação por Playwright ou inicialização de serviços Docker, desativadas
  nesta entrega por decisão explícita do owner.

## Riscos / Decisões pendentes

- O alvo interativo mobile fica no limite compacto de 32 px pedido pelo owner;
  os rótulos acessíveis e títulos existentes são preservados.
- A validação visual final depende do deploy, pois Playwright não será usado
  neste trabalho.
