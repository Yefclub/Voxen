# 063 — Cookies do yt-dlp (extração autenticada)

## Contexto

A extração de mídia via `yt-dlp` (worker) falha em casos que exigem sessão
autenticada:

- **Instagram**: para parte do conteúdo (reels/posts), o Instagram serve, sem
  login, um rendition **só-vídeo** (sem faixa de áudio). O `download_audio_opus`
  então estoura no `FFmpegExtractAudio`/ffprobe ("unable to obtain file audio
  codec") porque não há áudio. Com **cookies de uma sessão logada**, o yt-dlp
  obtém a mídia completa (com áudio).
- **YouTube**: páginas que disparam o anti-bot ("Sign in to confirm you're not a
  bot") passam a funcionar quando o yt-dlp envia cookies de uma conta logada.

Hoje a única config runtime do extrator é o proxy opcional (`yt_dlp_proxy_urls`,
setting cifrado em DB — ver specs 057/058). Esta feature espelha exatamente esse
padrão para um novo secret: o conteúdo de um arquivo `cookies.txt` (formato
Netscape) que o yt-dlp consome via `cookiefile`.

Cookies são **credenciais de sessão**. O tratamento é estritamente de secret:
cifrado em DB com a master key, nunca logado, nunca devolvido em texto por
endpoint, e materializado em disco apenas como arquivo temporário `600` de vida
curta, limpo imediatamente após cada invocação do yt-dlp.

## Glossário

- **cookies.txt (Netscape)**: formato texto de cookies exportado por extensões
  de browser (linhas separadas por TAB; opcionalmente prefixadas pelo cabeçalho
  `# Netscape HTTP Cookie File`). É o formato que o yt-dlp aceita em `cookiefile`.
- **cookiefile**: opção do yt-dlp (`opts["cookiefile"] = <path>`) que aponta para
  um arquivo `cookies.txt` em disco.
- **setting cifrado**: linha em `Setting` (`scope=GLOBAL`, `userId=null`) com
  `valueEnc` cifrado em AES-256-GCM pela master key (ver `apps/web/src/lib/
  settings.ts` e `apps/worker/src/voxen_settings.py`).

## Requisitos (EARS)

- **REQ-1** — Quando o admin salva cookies via endpoint, o sistema DEVE persistir
  o conteúdo como setting cifrado `yt_dlp_cookies` (mesma master key e helper
  `setSetting`/`getSetting` usados por `yt_dlp_proxy_urls`), nunca em texto puro.

- **REQ-2** — Quando o endpoint de status (`GET`) é consultado, o sistema DEVE
  retornar apenas `{ configured: boolean }`. O valor dos cookies NÃO DEVE ser
  devolvido (nem cifrado, nem em preview) por nenhum endpoint.

- **REQ-3** — Quando o admin envia conteúdo no `POST`, o sistema DEVE validar que
  o conteúdo parece um `cookies.txt` Netscape (contém linhas com TAB **ou** começa
  com `# Netscape HTTP Cookie File`). Se não parecer, DEVE rejeitar com `400` e
  NÃO persistir.

- **REQ-4** — Quando o admin chama o `DELETE`, o sistema DEVE remover o setting
  `yt_dlp_cookies`.

- **REQ-5** — Os endpoints de cookies DEVEM exigir role `ADMIN`, derivando o
  usuário da sessão (better-auth), nunca do body/query — coerente com o guard
  já existente em `apps/web/src/routes/admin.ts`.

- **REQ-6** — Quando há cookies configurados, o worker DEVE, em TODOS os caminhos
  do yt-dlp (`probe`, `download_audio_opus`, `download_subtitle`), materializar o
  conteúdo num arquivo temporário com permissão `600` e setar
  `opts["cookiefile"] = <path>` para aquela invocação.

- **REQ-7** — Enquanto NÃO houver cookies configurados, o worker NÃO DEVE setar
  `cookiefile` e o comportamento atual DEVE permanecer idêntico (sem regressão).

- **REQ-8** — O arquivo temporário de cookies DEVE ser removido logo após a
  invocação do yt-dlp que o usou (lifecycle fechado por contexto), de forma que
  nenhum cookies.txt persista em disco entre jobs.

- **REQ-9** — O conteúdo dos cookies NUNCA DEVE ser logado (nem em INFO, nem em
  erro/exception). Apenas o fato de estarem ativos (booleano) PODE aparecer em
  log, espelhando o padrão do proxy.

- **REQ-10** — A UI admin DEVE ser **write-only**: exibe somente
  "Configurado ✓ / Não configurado" + ações Salvar/Remover, com um campo de
  textarea para colar o `cookies.txt`. NUNCA exibe o valor salvo. Strings em
  pt-BR e en. Inclui ajuda curta (como exportar via extensão de browser; aviso de
  que cookies expiram, são da conta do próprio owner e que o uso deve respeitar os
  ToS da plataforma).

## Não-objetivos

- Não cobrir os caminhos `requests` (oEmbed) nem `youtube-transcript-api`: o foco
  é o yt-dlp. Eles seguem usando apenas o proxy, sem cookies.
- Não rotacionar/renovar cookies automaticamente — expiram; o owner reexporta e
  recola quando necessário.
- Não adicionar multi-conta ou cookies por-plataforma: um único secret global,
  espelhando `yt_dlp_proxy_urls`.

## Testes (TDD)

- **Worker**: com cookies configurados, `_runtime_options`/helper escreve um
  arquivo `600` e seta `opts["cookiefile"]`; sem cookies, `cookiefile` ausente;
  o conteúdo nunca aparece em logs capturados; o arquivo some após o contexto.
- **Web**: `POST` cifra (DB guarda `valueEnc` ≠ plaintext) e `GET` não vaza o
  valor (`configured` apenas); `DELETE` limpa; validação rejeita lixo com `400`.
