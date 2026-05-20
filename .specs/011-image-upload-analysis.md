# 011 — Upload de imagens para análise

## Objetivo

Permitir que a tela de transcrição aceite imagens além de áudio/vídeo. Imagens enviadas devem ser analisadas por um modelo multimodal configurado no setup e salvas como item pesquisável da biblioteca, com descrição em markdown e resumo best-effort.

## Requisitos

- O endpoint de upload DEVE aceitar `image/png`, `image/jpeg`, `image/webp` e `image/gif` com limite menor que áudio/vídeo.
- Imagens DEVEM ser armazenadas no mesmo namespace S3 de uploads do usuário.
- Upload de imagem DEVE criar um job assíncrono separado de transcrição de mídia.
- O worker DEVE usar `default_vision_model`; se não existir, deve falhar com erro permanente claro.
- O resultado DEVE virar `Transcript` com `source=UPLOAD`, método próprio de análise visual e texto pesquisável.
- A UI DEVE deixar claro que o modo arquivo aceita áudio, vídeo ou imagem.
- Telegram DEVE aceitar anexos de áudio/vídeo/documentos de mídia e enfileirar `UPLOAD_AND_TRANSCRIBE` quando o arquivo for suportado.
- Telegram DEVE aceitar fotos e documentos de imagem suportados e enfileirar `UPLOAD_AND_ANALYZE_IMAGE`.

## Fora de escopo

- Proxy anti-bot pelo navegador do usuário.
- OCR estruturado avançado, múltiplas imagens por job ou anexos em lote.
- Análise conversacional imediata de imagem no Telegram quando o usuário quiser perguntar sobre a imagem sem criar item na biblioteca.
