# 120 — Fix: retry com impersonate=chrome do TikTok nunca era alcançado

## Contexto

Investigação de falhas recentes de ingestão de vídeos do TikTok (logs de
produção, 2026-07-31): jobs falhavam com `EXTERNAL_DOWNLOAD_BLOCKED` quase
instantaneamente (2-5s entre `job-claimed` e `job-failed-permanent`),
sem nenhum log `tiktok-probe-retry-impersonate-chrome` ou
`tiktok-audio-retry-impersonate-chrome` — sinal de que a mitigação de
retry com impersonation de browser (existente há tempo em
`_run_pipeline`, `apps/worker/src/pipeline.py`) nunca disparava.

Causa raiz: `_retry_transient` tem um curto-circuito que converte erros
"amigáveis" determinísticos (antibot, geo, 403 — inclui o padrão de erro do
TikTok "unable to extract"/"rehydration"/"universal data") em
`PermanentError` já na 1ª tentativa, sem esgotar `tries`. O código chamador
em `_run_pipeline` espera capturar esse erro como `_TRANSIENT_EXC` para
então acionar o retry com `force_impersonate="chrome"`:

```python
try:
    probe_info = await _retry_transient(lambda: ytdl.probe(source_url), tries=3)
except _TRANSIENT_EXC as e:
    if _is_tiktok_rehydration_error(e) and video_url.detect_source(source_url) == "TIKTOK":
        ...retry com impersonate=chrome...
```

Só que `_retry_transient` já converteu a exceção em `PermanentError` antes
de sair — e `PermanentError` NÃO está em `_TRANSIENT_EXC`. O `except
_TRANSIENT_EXC` nunca casa, a exceção sobe direto como falha permanente, e
o bloco de retry com impersonate é código morto — nunca executado desde que
foi escrito.

Isso é relevante agora porque o TikTok está com uma quebra ativa e não
resolvida no `yt-dlp` upstream (issue
[yt-dlp/yt-dlp#17332](https://github.com/yt-dlp/yt-dlp/issues/17332),
aberta 2026-07-29, ainda `open`, sem PR em andamento) — o padrão observado
nos nossos logs é intermitente (mesmo request tipo ora funciona ora falha),
o que dá ao retry com impersonation uma chance real de recuperar parte
desses jobs, mas ele nunca teve chance de rodar.

## Requisitos (EARS)

- **Ubiquitous**: `_retry_transient` DEVE permitir que o chamador
  identifique, via predicado opcional, uma classe de erro que deve ser
  relançada crua (sem virar `PermanentError`, sem consumir tentativas) —
  para que o chamador aplique sua própria estratégia de retry alternativa.
- **Ubiquitous**: o comportamento de `_retry_transient` para QUALQUER
  chamador que não passe esse predicado DEVE permanecer idêntico ao atual
  (nenhuma regressão nos demais call sites — subtítulos, S3, OpenRouter via
  `_retry_transient_or` que é função separada).
- **Event**: quando o probe ou o download de áudio do TikTok falha com erro
  de rehydration, o pipeline DEVE tentar novamente com
  `force_impersonate="chrome"` antes de desistir — como já era a intenção
  original do código, agora efetivamente alcançável.

## Critérios de aceite

- [x] `_retry_transient` ganha parâmetro opcional `immediate_passthrough`
      que, quando casa com a exceção, relança crua imediatamente.
- [x] Os dois call sites do TikTok (`probe`, `download_audio_opus`) passam
      `immediate_passthrough=_is_tiktok_rehydration_error`.
- [x] Teste de regressão prova: com o predicado, a exceção crua chega ao
      chamador em 1 tentativa (sem virar `PermanentError`); sem o
      predicado, comportamento antigo é preservado (retrocompatibilidade
      dos demais call sites).
- [x] `pytest`, `ruff check`, `mypy` sem erro no worker.

## Fora de escopo

- O path de legendas (`download_subtitle`) não tem retry com impersonate
  para TikTok hoje — não há evidência nos logs de que TikTok segue esse
  caminho na prática (vídeos observados foram todos via `path-api`, sem
  legendas disponíveis). Adicionar isso é extensão futura, não parte deste
  fix pontual.
- A causa raiz externa (quebra do extractor TikTok no yt-dlp) não é
  corrigível no nosso código — este PR só destrava a mitigação já prevista
  que nunca rodava; não elimina falhas quando mesmo o impersonate=chrome
  também não for suficiente (extractor upstream ainda quebrado).
