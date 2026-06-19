# 046 — Validação com ffprobe antes de transcrever

## Contexto

O worker de transcrição (`apps/worker`) baixa o áudio (YouTube via
`ytdl.download_audio_opus` ou upload local via `uploaded_media.extract_audio_opus`)
e em seguida o envia pra API de transcrição da OpenRouter (via
`_transcribe_via_api` → `split_audio` → `transcribe_audio`).

Hoje, áudio vazio, corrompido, com duração zero ou sem faixa de áudio só falha
**tarde** — depois de baixar/extrair o arquivo e, no pior caso, depois de já ter
chamado a API e queimado tokens. O chunking (`split_audio`) e a chamada à API são
caros; um arquivo inválido deveria ser barrado **antes**.

O upload local já roda um `ffprobe` parcial (`uploaded_media.probe_duration_sec`,
só `format=duration`), mas o path YouTube (download → API) não tem nenhuma
validação equivalente, e nenhum dos dois verifica presença de stream de áudio nem
tamanho do arquivo final que vai pra API.

`ffprobe` já acompanha o `ffmpeg` na mesma imagem do worker — sem dependência nova.

## Escopo

- Apenas `apps/worker`. Não toca em `apps/web` nem `apps/chat`.
- Inserir uma etapa de validação por `ffprobe` no ponto único que ambos os
  pipelines (download YouTube e upload local) compartilham antes de mandar pra API:
  `_transcribe_via_api`, imediatamente antes do `split_audio`/chamada à OpenRouter.
- Usar `ffprobe -v error -print_format json -show_format -show_streams` via
  subprocess assíncrono (mesmo padrão de `uploaded_media`/`audio_chunking`).

## Não-objetivos

- Não substituir o `probe_duration_sec` existente do upload (ele continua sendo a
  fonte de `duration_sec` cedo, antes de extrair áudio). A validação nova é a última
  barreira sobre o arquivo de áudio que efetivamente vai pra API.
- Não validar transcodificação/qualidade do áudio — só integridade estrutural.
- Não introduzir dependência nova (ffprobe já existe na imagem).

## Requisitos (EARS)

### R1 — Validação antes da API

- WHEN o pipeline está prestes a transcrever um arquivo de áudio via OpenRouter
  THEN o sistema SHALL validar o arquivo com `ffprobe` ANTES de chamar `split_audio`
  e a API.

### R2 — Critérios de validação

- WHEN o arquivo de áudio não existe ou tem tamanho 0 bytes THEN o sistema SHALL
  falhar cedo (permanente) sem chamar a API.
- WHEN o `ffprobe` não reporta nenhum stream de áudio THEN o sistema SHALL falhar
  cedo (permanente) sem chamar a API.
- WHEN a duração reportada é ≤ 0 ou não numérica THEN o sistema SHALL falhar cedo
  (permanente) sem chamar a API.
- WHEN a duração reportada excede `MAX_DURATION_SEC` (4h, alinhado com `ytdl`)
  THEN o sistema SHALL falhar cedo (permanente) sem chamar a API.
- WHEN o tamanho do arquivo excede `MAX_AUDIO_BYTES` (constante definida no worker)
  THEN o sistema SHALL falhar cedo (permanente) sem chamar a API.

## R3 — Mensagem clara e logging estruturado

- WHEN a validação falha THEN o sistema SHALL registrar via structlog um evento
  estruturado (`audio-validation-failed`) com o motivo e SHALL converter a falha em
  `PermanentError` com mensagem clara em PT-BR (sem exceção crua sem contexto).

## R4 — ffprobe ausente / erro de execução (degradação graceful)

- WHEN o binário `ffprobe` não está disponível (FileNotFoundError) OU o `ffprobe`
  retorna um JSON inválido/inesperado THEN o sistema SHALL registrar um warning
  (`audio-validation-skipped`) e SEGUIR para a transcrição — a validação NÃO bloqueia
  o job nesse caso, pra não travar produção se a imagem mudar/o binário sumir.
- WHEN o `ffprobe` não responde dentro de `FFPROBE_TIMEOUT_SEC` (30s) THEN o sistema
  SHALL matar o processo, registrar `ffprobe-timeout` e SEGUIR para a transcrição
  (mesma degradação graceful) — um ffprobe pendurado não pode travar o job.
- Justificativa: a validação é uma otimização de "fail fast", não um gate de
  segurança. Se a ferramenta de validação some, o comportamento correto é degradar
  para o comportamento atual (deixar a API decidir), não derrubar todos os jobs.

## Critérios de aceite

- `make lint`, `make typecheck` (tsc + mypy) e `make test-py` verdes a partir da raiz.
- `cd apps/worker && uv run ruff format --check .` verde.
- Testes pytest (mockando o subprocess `ffprobe`) cobrindo:
  - áudio válido (1 stream de áudio, duração > 0, dentro dos limites) passa;
  - sem stream de áudio falha cedo;
  - duração zero falha cedo;
  - arquivo ausente / tamanho 0 falha cedo;
  - `ffprobe` ausente (FileNotFoundError) → segue com warning, não bloqueia.
- Nenhuma chamada à OpenRouter quando a validação reprova.
