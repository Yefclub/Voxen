# Spec 019 — SSE estável atrás de Easypanel/Traefik

## Contexto

O deploy Easypanel roda o Voxen atrás do Traefik com HTTP/2 no navegador e HTTP
interno até o App. A rota global `/api/jobs/events/me` usa SSE para notificar
jobs finalizados, mas o browser reportou `ERR_HTTP2_PROTOCOL_ERROR 200 (OK)`
enquanto o Traefik registrava respostas curtas de 27 bytes. Os jobs concluíram,
mas o stream global ficava reconectando com ruído no console.

Também foi observado `Better Auth: Invalid origin` quando o domínio acessado no
navegador não batia com `APP_BASE_URL`, além do warning operacional do Redis
sobre `vm.overcommit_memory`.

## Requisitos

### Ubiquitous

- The app shall serve job SSE responses without HTTP/1-only hop-by-hop headers.
- The app shall keep global job notification streams alive behind common
  HTTP/2 reverse proxies.
- Deployment docs shall explain the exact relationship between `APP_BASE_URL`
  and `BETTER_AUTH_TRUSTED_ORIGINS`.

### Event-driven

- When a client opens `/api/jobs/events/me`, the server shall send an immediate
  `connected` event and a heartbeat before the first idle timeout window.
- When a client opens `/api/jobs/:id/events`, the server shall continue to emit
  progress and terminal events for the specific job.
- When a job-specific SSE stream reaches `done`, `failed` or `cancelled`, the
  stream shall close cleanly after delivering the terminal event.

### State-driven

- If the client disconnects, Redis subscriber connections shall be closed.
- If the job is already terminal when `/api/jobs/:id/events` opens, the endpoint
  shall send a snapshot and close.
- If an Easypanel instance uses more than one public origin, operators shall be
  able to configure the extra origins without code changes.

## Critérios de aceite

- [x] SSE responses do not include `Connection` or `Transfer-Encoding` headers.
- [x] `/api/jobs/events/me` uses short heartbeat and explicit EventSource retry.
- [x] `/api/jobs/:id/events` preserves existing progress/snapshot behavior.
- [x] Tests cover the HTTP2-safe SSE headers.
- [x] `.env.example` documents `BETTER_AUTH_TRUSTED_ORIGINS`.
- [x] Deploy docs PT/EN document Better Auth origin troubleshooting.
- [x] Deploy docs mention Redis `vm.overcommit_memory` warning.

## Fora de escopo

- Changing Traefik/Easypanel internals.
- Replacing SSE with WebSocket.
- Automatic host-level sysctl mutation during app deploy.
