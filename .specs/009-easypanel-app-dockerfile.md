# 009 — Easypanel App via Dockerfile

## Objetivo

Permitir deploy no Easypanel como um único serviço App construído por `Dockerfile`,
usando serviços gerenciados/separados do Easypanel para Postgres, Redis e MinIO.

## Escopo

- Manter `docker-compose.yml` como caminho de dev/local e VPS completo.
- Adicionar um `Dockerfile` na raiz para o modo Easypanel App.
- Rodar `web`, `chat` e `worker` no mesmo container no modo App.
- Usar `MASTER_KEY` como secret em env para o modo App.
- Manter fallback de `MASTER_KEY_PATH` para compatibilidade com o Compose atual.

## Requisitos

- REQ-001: Quando `MASTER_KEY` estiver definido, web/chat/worker devem usar esse valor
  como chave AES-256-GCM, em base64 de 32 bytes.
- REQ-002: Quando `MASTER_KEY` não estiver definido, o comportamento legado via
  `MASTER_KEY_PATH` deve continuar funcionando.
- REQ-003: O Dockerfile raiz deve construir uma imagem que contém web, chat e worker.
- REQ-004: No startup da imagem App, `prisma generate` e `prisma migrate deploy`
  devem rodar antes do web server iniciar.
- REQ-005: No modo App, o container deve expor apenas a porta HTTP do web (`3000`,
  ou `PORT` quando definido).
- REQ-006: No modo App, `CHAT_SERVICE_URL` deve apontar por padrão para o chat local
  em `http://127.0.0.1:8001`.
- REQ-007: O modo App deve exigir Postgres, Redis e S3 externo por env, sem iniciar
  Postgres/Redis/Garage dentro da mesma imagem.

## Fora de escopo

- Remover o Compose atual.
- Criar serviços Postgres/Redis/MinIO via API do Easypanel.
- Rotação de master key.
