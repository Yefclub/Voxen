# 014 — UI, Configuração Operacional e Release Flow

## Contexto

Depois das features de upload, documentos, análise de imagem e X/Grok, a tela de
configuração ficou misturando escolha de modelos com ajustes operacionais de
extração de mídia. Também há ruído visual na rolagem da aplicação e o fluxo de
versão atual cria commits automáticos em `dev`, tags `-dev.N` e divergência
desnecessária entre `dev` e `main`.

## Objetivos

1. Corrigir rolagem duplicada/fora de lugar na shell da aplicação.
2. Manter "Base de conhecimento" em uma linha na sidebar.
3. Mover ajustes anti-bot/extração de mídia para uma seção de configuração
   operacional, fora do bloco de modelos.
4. Melhorar a experiência de seleção de modelos.
5. Trocar cópias públicas de "yt-dlp pipeline" por "extração de mídia", sem
   quebrar compatibilidade das settings cifradas existentes.
6. Completar pendências abertas e fechar issues já resolvidas por código.
7. Simplificar release/versionamento: `dev` não deve receber commits automáticos
   de pre-release; tags estáveis continuam sendo fonte de release.

## Fora de escopo

- Renomear a dependência `yt-dlp` ou remover seu uso interno.
- Alterar schema Prisma para renomear settings já salvas.
- Reescrever todo o pipeline de mídia.

## Critérios de aceite

- [x] Uma página autenticada longa tem apenas um container principal de rolagem.
- [x] Páginas públicas continuam roláveis quando o conteúdo excede a viewport.
- [x] A sidebar não quebra "Base de conhecimento" em duas linhas no estado aberto.
- [x] `/setup` separa "Modelos padrão" de "Operação da instância".
- [x] Ajustes de cookies/proxy/user-agent/clientes YouTube aparecem como
      "Extração de mídia", não como modelo.
- [x] `/api/setup` lê e persiste `admin_email` e `summary_timeout_sec`.
- [x] O worker usa `summary_timeout_sec` no proxy para o chat service.
- [x] Mensagens user-facing de bloqueio YouTube orientam "configurações de
      extração" em vez de "clients do yt-dlp".
- [x] `version-dev.yml` deixa de commitar/tagear `vX.Y.Z-dev.N` em `dev`.
- [x] `version-main.yml` mantém release estável e sincroniza a versão estável
      de volta para `dev` após tag.
- [x] Documentação descreve o novo fluxo de versão.
- [x] Testes automatizados cobrem os novos campos de setup e timeout do worker.
- [x] UI verificada por Playwright em desktop e mobile.
