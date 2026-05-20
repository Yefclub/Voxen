# 013 — Analise do X, seletor de modelos e resiliencia yt-dlp

## Objetivo

Separar posts do X do pipeline de download de video quando houver modelo Grok/xAI configurado, usando OpenRouter com busca nativa, e melhorar a configuracao operacional do yt-dlp sem depender de proxies publicos automaticos.

## Regras

- Links `x.com/.../status/...` e `twitter.com/.../status/...` continuam canonicalizados para `https://x.com/i/status/<id>`.
- Se `default_x_analysis_model` existir, o job criado para X deve ser `ANALYZE_X`.
- Se `default_x_analysis_model` nao existir, o comportamento antigo de `DOWNLOAD_AND_TRANSCRIBE` fica preservado para posts com midia.
- O worker salva analises de X como `TranscriptSource=X` e `TranscriptionMethod=X_SEARCH`.
- Custos de chamadas Grok/OpenRouter para X entram como `CostEventKind=X_SEARCH`.
- A configuracao `yt_dlp_youtube_clients` e opcional. Vazia significa deixar o yt-dlp escolher o client padrao.
- Proxies/cookies/clientes do yt-dlp sao configuracoes do operador. Nao usar proxies publicos automaticos embutidos na aplicacao.
- O seletor de modelos deve suportar busca, listas grandes e estado opcional sem depender de dropdown estreito.
