# 035 — Extração de TikTok via impersonation (curl_cffi)

## Contexto

Envios de links do TikTok passaram a falhar com:

```
ERROR: [TikTok] <id>: Unable to extract universal data for rehydration;
please report this issue on https://github.com/yt-dlp/yt-dlp/issues
```

A causa não é versão velha do yt-dlp — o worker já roda a estável mais recente
(`2026.06.09`). O log de origem traz o aviso *"The extractor is attempting
impersonation, but no impersonate target is available"*: o extractor do TikTok
pede impersonation de browser (TLS/JA3) sozinho, mas o backend `curl_cffi` não
estava instalado (`yt-dlp[default,deno]`). Sem ele, o TikTok devolve uma página
que o yt-dlp não consegue parsear.

## Escopo

- Instalar o backend de impersonation `curl_cffi` via extra `yt-dlp[curl-cffi]`.
- Permitir forçar um alvo de impersonation por env (`YTDLP_IMPERSONATE`), opcional.
- Mensagem de erro amigável e acionável quando a extração do TikTok falhar.
- Garantir no build (Docker) que o backend está presente.

## Requisitos

### R1 — Backend de impersonation disponível

- WHEN o worker é construído THEN o ambiente SHALL incluir `curl_cffi` e o build
  SHALL falhar se o backend estiver ausente.
- WHEN o extractor do yt-dlp solicita impersonation THEN um alvo de browser
  SHALL estar disponível para auto-seleção (caso comum, sem configuração).

### R2 — Override por operador

- WHEN `YTDLP_IMPERSONATE` está setado com um alvo válido (ex.: `chrome`,
  `chrome-124:windows-10`) THEN as opções do yt-dlp SHALL forçar esse alvo.
- WHEN `YTDLP_IMPERSONATE` está vazio, ausente ou desligado (`off`/`false`/`none`)
  THEN nenhum alvo SHALL ser forçado e o extractor SHALL auto-selecionar.
- WHEN o alvo é inválido ou a API do yt-dlp mudou THEN o worker SHALL seguir sem
  forçar impersonation, sem derrubar o job por erro de configuração.

### R3 — Erro amigável

- WHEN a extração do TikTok falha por "unable to extract"/"rehydration" THEN o
  job SHALL falhar com mensagem em PT-BR orientando nova tentativa e upload manual,
  em vez do stack trace cru do yt-dlp.

## Fora de escopo

- Forçar impersonation por padrão em todas as plataformas (evita regressão no
  fluxo de YouTube, que usa player_client + POT).
- Configuração de impersonation via UI/DB (segue o padrão env-only do bgutil).
- Garantia de extração do TikTok sob qualquer bloqueio de IP/região de VPS.

## Critérios de aceite

- [ ] `curl_cffi` resolvido no `uv.lock` e importável; smoke check no Dockerfile.
- [ ] `_runtime_options()` força `impersonate` somente quando o env pede.
- [ ] `_friendly_external_error` cobre o caso TikTok.
- [ ] Testes do worker (ruff, mypy, pytest) verdes; build Docker do worker passa.
