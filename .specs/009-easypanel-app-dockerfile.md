# 009 — Easypanel App via Dockerfile

## Objetivo

Permitir deploy no Easypanel como um único serviço App construído por `Dockerfile`,
usando serviços gerenciados/separados do Easypanel para Postgres, Redis e MinIO.

## Escopo

- Manter `docker-compose.yml` como caminho de dev/local e VPS completo.
- Adicionar um `Dockerfile` na raiz para o modo Easypanel App.
- Rodar `web`, `chat` e `worker` no mesmo container no modo App.
- Usar `MASTER_KEY` como secret em env para todos os modos documentados.
- Usar MinIO como S3 padrão no Compose local/prod, alinhado ao Easypanel.
- Manter fallback de `MASTER_KEY_PATH` apenas para instalações legadas.

## Requisitos

- REQ-001: Quando `MASTER_KEY` estiver definido, web/chat/worker devem usar esse valor
  como chave AES-256-GCM, em base64 de 32 bytes.
- REQ-002: Todos os modos de instalação documentados devem configurar a master key
  via `MASTER_KEY`, no mesmo formato do Easypanel (`openssl rand -base64 32`).
- REQ-003: O Dockerfile raiz deve construir uma imagem que contém web, chat e worker.
- REQ-004: No startup da imagem App, `prisma generate` e `prisma migrate deploy`
  devem rodar antes do web server iniciar.
- REQ-005: No modo App, o container deve expor apenas a porta HTTP do web (`3000`,
  ou `PORT` quando definido).
- REQ-006: No modo App, `CHAT_SERVICE_URL` deve apontar por padrão para o chat local
  em `http://127.0.0.1:8001`.
- REQ-007: O modo App deve exigir Postgres, Redis e S3 externo por env, sem iniciar
  Postgres/Redis/MinIO dentro da mesma imagem.
- REQ-008: O Compose local deve subir Postgres, Redis, MinIO, web, chat e worker
  com `make dev`, criando/completando `.env` local quando necessário.
- REQ-009: O CI deve construir o Dockerfile raiz e executar smoke test com
  Postgres, Redis e MinIO reais antes de considerar o PR verde.

## Fora de escopo

- Remover o fallback legado de `MASTER_KEY_PATH` do código.
- Criar serviços Postgres/Redis/MinIO via API do Easypanel.
- Rotação de master key.
