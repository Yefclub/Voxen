---
tipo: feat
titulo: Voxen 0.14.0 — espaços pessoais, login empresarial e qualidade verificável
---

## Uma interface que se adapta a cada pessoa

Cada usuário pode continuar com a navegação clássica ou ativar o novo modo
focado, inspirado no Vesper. Nesse modo, a navegação fica integrada ao fundo e
o conteúdo principal ganha uma superfície dedicada, sem alterar a experiência
em telas menores. A preferência é pessoal, acessível e permanece sincronizada
quando a pessoa retorna a outra aba do navegador.

## Administração e conta pessoal em lugares distintos

Configurações compartilhadas da instância agora vivem em uma área administrativa
própria, separada das páginas de uso diário e dos dados particulares. Modelos,
autenticação, integrações, usuários e custos ficam claros para administradores,
enquanto cada pessoa controla os próprios acessos MCP, expiração e revogação sem
expor segredos de outros usuários.

## Login empresarial com OIDC seguro

Administradores podem configurar provedores OpenID Connect para os domínios da
organização. O fluxo usa PKCE, exige e-mail verificado, valida destinos HTTPS e
mantém a política de aprovação de contas da Voxen. Segredos do provedor ficam
criptografados, tokens do provedor não são armazenados e contas bloqueadas ou
rejeitadas não conseguem criar sessão.

## Qualidade e migrations verificadas antes do merge

O CI ganhou uma catraca de qualidade que acompanha cobertura, duplicação e
tamanho de arquivos sem exigir que toda a dívida histórica seja resolvida de
uma vez. Novas regressões são bloqueadas e recebem um relatório próprio para
orientar a correção.

O histórico do Prisma também passa por um gate dedicado: mudanças de schema
exigem migrations ordenadas, o histórico integrado não pode ser reescrito e a
evolução completa é reproduzida em PostgreSQL isolado antes do merge.

## Dependências críticas atualizadas e auditadas

As dependências web e do worker receberam correções para quatro vulnerabilidades
de alta severidade. O CI agora bloqueia novas ocorrências nas duas plataformas,
e a imagem do worker passa a instalar o lockfile auditado de forma estrita para
que o ambiente publicado corresponda ao que foi validado.

## Rolagem e grafo mais previsíveis

O modo focado ganhou barras de rolagem alinhadas às superfícies arredondadas,
com controles direcionais completos no desktop e comportamento preservado em
dispositivos de toque. No grafo, cobertura parcial deixa de aparecer como falha:
a interface explica que o conteúdo está aguardando indexação, respeita a janela
de nova tentativa sem consultas infinitas e atualiza o mapa assim que o processo
converge.

## Novidades de produção confiáveis

A preparação da release agora grava a nota curada no feed de **Novidades** de
forma idempotente. Assim, a página mostra o que realmente chegou à produção,
sem duplicar versões nem confundir entradas de desenvolvimento com releases
estáveis.
