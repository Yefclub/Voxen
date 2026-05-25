# Spec 018 — Legendas primeiro e runtime YouTube resiliente

## Contexto

Voxen ja usa `yt-dlp` para probe, legendas e audio. Em VPS, porem, ate chamadas
de metadata podem cair em bloqueio anti-bot antes de o worker tentar baixar
legendas. A estrategia desta spec e inverter o custo operacional: para links do
YouTube, tentar obter transcript/legendas primeiro por um caminho leve; so usar
audio quando nao houver legenda acessivel.

A spec 016 continua valida: nao reintroduzir cookies de conta Google nem uma
tela cheia de configuracoes avancadas. PO token/bgutil fica como melhoria
operacional opt-in por variavel de ambiente, sem promessa de bypass garantido.

## Requisitos

### Ubiquitous

- The system shall try a caption/transcript-only path before downloading audio
  for YouTube URLs.
- The system shall keep manual upload as the universal fallback when external
  extraction is blocked.
- The worker image shall include the runtime dependencies recommended for
  current `yt-dlp` YouTube support that pass security scanning: `yt-dlp`
  default extras and a JavaScript runtime.

### Event-driven

- When a YouTube transcript can be fetched without downloading media, the
  system shall persist the transcript as `TranscriptionMethod=SUBTITLES` with
  zero transcription cost.
- When the transcript-only path fails, the system shall continue to the existing
  `yt-dlp` subtitle path and then the audio transcription path.
- When a bgutil HTTP provider URL is configured by environment, the worker shall
  pass it to `yt-dlp` and prefer the `mweb` YouTube client for that extraction.

### State-driven

- If no bgutil provider URL is configured, the worker shall not force PO token
  mode or alternative YouTube clients.
- If only a SOCKS proxy is configured, the transcript-only helper may skip
  proxying that helper and let the normal `yt-dlp` path handle the proxy.

## Critérios de aceite

- [ ] YouTube jobs attempt `youtube-transcript-api` before `yt-dlp` audio.
- [ ] Transcript-only success skips media download and OpenRouter audio cost.
- [ ] Existing `yt-dlp` subtitle and audio fallbacks remain intact.
- [ ] Worker dependencies include `youtube-transcript-api` explicitly.
- [ ] Worker dependencies include `yt-dlp` extras for EJS and Deno.
- [ ] Docker build verifies that the Deno runtime is present in the worker
      image.
- [ ] bgutil PO token provider is opt-in via env and does not require UI
      changes.
- [ ] Focused tests cover transcript-first and runtime option behavior.

## Fora de escopo

- Cookies de conta Google.
- Proxies publicos gratuitos.
- Garantia de download em qualquer VPS.
- Sidecar obrigatorio de bgutil no `docker-compose.yml`.
- Worker residencial remoto puxando jobs da VPS.
