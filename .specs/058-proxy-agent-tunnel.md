# 058 — Suporte a proxy SOCKS5 no worker

## Contexto

O worker (`apps/worker`) baixa mídia (yt-dlp), busca transcrições do YouTube
(`youtube-transcript-api`) e metadata via oEmbed (`requests`). Hoje todos esses
caminhos só aceitam proxy `http://`/`https://`, configurado pelo operador no
setting `yt_dlp_proxy_urls` (ou env `YTDLP_PROXY_URLS`/`YTDLP_PROXY_URL`).

Deploys em VPS frequentemente roteiam por túneis/proxies residenciais que expõem
um endpoint SOCKS5 (ex.: `socks5h://user:pass@host:1080`). O helper
`_is_http_proxy` em `src/ytdl.py` filtra qualquer URL que não comece com
`http://`/`https://`, então um proxy SOCKS5 configurado é silenciosamente
ignorado nos caminhos `youtube-transcript-api` e `oembed` (yt-dlp já suporta
SOCKS nativo via `opts["proxy"]`, mas o filtro de validação não reconhecia).

## Requisitos (EARS)

- **R1** — When o operador configura um proxy com esquema `socks5://` ou
  `socks5h://` em `yt_dlp_proxy_urls` (ou nas envs de proxy), the worker shall
  usar esse proxy em todos os caminhos de rede de extração: download via yt-dlp,
  busca de transcrição (`youtube-transcript-api`) e oEmbed (`requests`).
- **R2** — While um proxy `http://`/`https://` está configurado, the worker shall
  continuar funcionando exatamente como antes (sem regressão).
- **R3** — When nenhum proxy está configurado (vazio/`None`), the worker shall
  operar sem proxy em todos os caminhos.
- **R4** — When o valor de proxy tem esquema não suportado (ex.: `ftp://`,
  string vazia, lixo), the worker shall tratá-lo como ausência de proxy nos
  caminhos `requests`/`youtube-transcript-api` (não montar dict de proxy).

## Design

- Renomear `_is_http_proxy` → `_is_supported_proxy`, aceitando os esquemas
  `http://`, `https://`, `socks5://`, `socks5h://`. Ajustar call sites
  (`_transcript_proxy_config`, `_requests_proxy_dict`).
- `youtube-transcript-api` usa `GenericProxyConfig(http_url=..., https_url=...)`,
  que delega ao `requests` por baixo — uma URL `socks5h://` funciona desde que o
  PySocks esteja instalado.
- `requests` precisa de PySocks para SOCKS. Adicionar a dependência via
  `requests[socks]` no `apps/worker` (pyproject + uv.lock).
- yt-dlp já suporta SOCKS nativamente; basta o filtro de validação não barrar.
- Recomendar `socks5h://` (resolução de DNS pelo proxy) em comentário/doc, mas
  aceitar ambos.

## Critérios de Aceite

1. `_is_supported_proxy` aceita `http`, `https`, `socks5`, `socks5h` e rejeita
   esquemas desconhecidos, string vazia e `None`.
2. `_requests_proxy_dict` e `_transcript_proxy_config` montam a config correta
   para uma URL `socks5h://` e retornam `None` para proxy ausente/inválido.
3. `requests[socks]`/PySocks presente no lock do worker.
4. Caminho http(s) e caminho sem proxy seguem inalterados (testes existentes
   continuam verdes).
