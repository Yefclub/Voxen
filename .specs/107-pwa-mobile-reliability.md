# 107 — Confiabilidade do PWA e ergonomia mobile

## Contexto

O Voxen já é instalável e possui Web Share Target, mas a experiência instalada
precisa ser mais segura em rede instável, durante atualizações e no uso por
toque. A auditoria também identificou modais de Automações sem o contrato de
acessibilidade já oferecido pelo componente `Dialog` do projeto.

## Requisitos

- **REQ-1**: QUANDO o PWA detectar uma nova versão durante uma resposta do chat,
  ENTÃO a ação de atualizar DEVE ficar indisponível e explicar que é necessário
  aguardar o término da resposta.
- **REQ-2**: QUANDO o usuário aplicar uma atualização, ENTÃO o fallback NÃO DEVE
  apagar todos os caches nem desregistrar o service worker.
- **REQ-3**: QUANDO o browser suportar instalação PWA ou o usuário estiver no
  Safari iOS fora do modo standalone, ENTÃO o app DEVE oferecer uma orientação
  de instalação que possa ser dispensada.
- **REQ-4**: QUANDO a verificação de sessão falhar por rede/servidor, ENTÃO o
  app NÃO DEVE tratar automaticamente a falha como logout; DEVE oferecer retry.
- **REQ-5**: Os modais de criar/editar automação e visualizar execuções DEVEM
  usar o `Dialog` acessível compartilhado, incluindo foco, Escape e bloqueio do
  conteúdo de fundo.
- **REQ-6**: Controles móveis persistentes do shell DEVEM ter alvo de toque de
  pelo menos 40 px.
- **REQ-7**: O tema inicial do HTML e do manifest DEVEM usar o tema zinc, e a
  meta `theme-color` DEVE acompanhar a escolha do usuário após a carga.
- **REQ-8**: O PWA NÃO DEVE bloquear a orientação do dispositivo em retrato.

## Fora de escopo

- Cache offline de dados autenticados ou uploads em fila persistente.
- Notificações push.
- Validação visual por Playwright ou execução de Docker.

## Critérios de aceite

- `bun test`, `bun run lint`, `bun run typecheck` e `bun run format:check` do
  app web passam sem iniciar serviços locais.
- A atualização preserva o service worker/caches no fallback.
- A página de Automações não possui mais modal manual nem lock de body próprio.
- O manifest gerado não contém `orientation: portrait` e usa `#212121` como
  `theme_color` padrão.
