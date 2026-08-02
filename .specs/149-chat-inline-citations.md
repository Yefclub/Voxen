# 149 — Fontes integradas e citações inline no Chat

## Objetivo

Tornar as evidências do Chat parte da leitura da resposta: no desktop, o painel de
fontes divide a largura do Chat em vez de sobrepor a conversa; nas ações da resposta,
o atalho de fontes aparece junto de copiar somente em hover/foco; e afirmações
referenciadas carregam citações compactas inline.

## Requisitos

- Quando o usuário abrir as fontes de uma resposta no desktop, o Chat DEVE reduzir
  sua área útil e exibir um painel lateral persistente, com scroll próprio e botão
  de fechar. Em viewport mobile, o painel pode continuar modal para não comprimir
  a leitura.
- O atalho de fontes DEVE usar a mesma visibilidade por hover/foco do botão de
  copiar e ficar na mesma linha de ações da resposta.
- O painel DEVE mostrar somente as citações estruturadas persistidas na mensagem e
  preservar título, trecho, âncora, link e estado de verificação.
- Para uma citação cuja evidência estruturada é `verified` e não está `stale`, a
  resposta DEVE poder renderizar um marcador `[n]` imediatamente após a afirmação.
  Hover/foco mostra preview; clique abre a fonte navegável.
- Um marcador informado pelo modelo sem uma evidência verificada correspondente
  DEVE permanecer texto comum, sem link, selo ou preview.
- A instrução do agente DEVE pedir marcadores `[n]` apenas depois de chamar
  `verify_citations`, na mesma ordem das claims verificadas. O contrato da UI
  continua sendo a evidência determinística persistida, nunca a afirmação livre.

## Fora de escopo

- Não expor raciocínio interno, chamadas de tools ou IDs internos.
- Não alterar a semântica de `verify_citations`, o escopo por usuário ou o modelo
  de persistência de evidências.
- Não criar fontes para pesquisa externa neste incremento; o contrato atual cobre
  transcrições verificadas do workspace.

## Aceite

- Abrir fontes reduz a largura do Chat em desktop e fechar restaura a largura.
- Em desktop, copiar e fontes ficam invisíveis até hover/foco da resposta e são
  acionáveis por teclado.
- `[1]` associado a uma evidência válida oferece preview e navegação; `[99]` sem
  evidência permanece sem comportamento especial.
- Lint, typecheck, testes e build passam.
