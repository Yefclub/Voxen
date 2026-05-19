# Spec 010 — Upload de mídia para transcrição

## Objetivo

Permitir que usuários aprovados enviem arquivos de áudio ou vídeo diretamente pela tela de transcrição. O arquivo deve entrar na mesma fila de jobs, ser convertido para áudio quando necessário, transcrito pelo modelo padrão de transcrição e salvo na biblioteca como os conteúdos vindos de links.

## Escopo

- UI em `/jobs` com modo `Link` e modo `Arquivo`.
- Endpoint autenticado `POST /api/jobs/upload` com multipart/form-data.
- Armazenamento do arquivo bruto no S3 do workspace antes de enfileirar.
- Novo tipo de job `UPLOAD_AND_TRANSCRIBE`.
- Novo source de transcript `UPLOAD`.
- Worker baixa o arquivo do S3, valida duração máxima de 4h, extrai áudio para Opus e usa o pipeline de transcrição via API.
- Detalhes/lista de jobs mostram nome amigável do arquivo, sem expor `upload://...` como link externo.
- Erros conhecidos do `yt-dlp` por bloqueio anti-bot/cookies devem virar mensagem curta em PT-BR com orientação para upload.

## Fora de escopo

- Upload multipart direto do browser para S3.
- Retenção/limpeza automática dos arquivos brutos enviados.
- Cookies de YouTube armazenados na aplicação.
- Scraping dedicado de texto puro do X/Twitter.

## Decisões

- A API usa um `sourceUrl` interno no formato `upload://<uploadId>/<filename-encoded>`.
- A chave S3 do arquivo bruto é derivada de `userId`, `uploadId` e `filename`, sem persistir metadados adicionais no banco nesta iteração.
- Limite inicial do arquivo: 500 MiB, validado por `Content-Length` e por `File.size`.
- Tipos aceitos: `audio/*`, `video/*` e extensões comuns (`mp3`, `wav`, `m4a`, `aac`, `ogg`, `opus`, `flac`, `mp4`, `mov`, `m4v`, `webm`, `mkv`, `avi`).

## Critérios de aceite

- Criar job por upload e acompanhar progresso via SSE.
- Transcrição concluída aparece na biblioteca com `source=UPLOAD`.
- Retry preserva o tipo original do job, inclusive web scrape e upload.
- X/Twitter continua aceito para posts públicos com mídia.
- O erro do print não deve aparecer cru para o usuário.
- Testes automatizados cobrindo helpers críticos e rota de upload.
