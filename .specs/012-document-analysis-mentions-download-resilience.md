# 012 - Documentos, menções de biblioteca e resiliência de download

## Objetivo

Adicionar ingestão de documentos ao Voxen, permitir que o chat mencione itens da biblioteca com `@`, melhorar a resiliência do download de vídeos e corrigir pequenas lacunas de UI/configuração.

## Escopo

- Upload web e Telegram devem aceitar documentos além de áudio, vídeo e imagem.
- Documentos gerais devem ser convertidos para Markdown com MarkItDown antes da análise.
- PDFs devem usar modelo OpenRouter configurável com suporte a entrada nativa de arquivo/PDF quando disponível.
- Custos de análise documental devem aparecer no painel de custos.
- Chat deve permitir mencionar transcrições/notas da biblioteca, com resolução server-side e autorização por usuário.
- Download via yt-dlp deve aceitar configuração segura de cookies/proxy/user-agent e tentar clientes YouTube alternativos antes de falhar com mensagem amigável.
- `/grafo` deve manter o ícone de busca visível.
- Estrutura `.claude` deve ser espelhada para `.agents`, exceto configurações locais.

## Requisitos

### Upload e análise de documentos

- Quando o usuário enviar documento suportado pela UI web, o sistema DEVE salvar o arquivo no S3 e criar job `UPLOAD_AND_ANALYZE_DOCUMENT`.
- Quando o usuário enviar documento suportado pelo Telegram, o sistema DEVE salvar o arquivo no S3 e criar job `UPLOAD_AND_ANALYZE_DOCUMENT`.
- Quando o job for documento PDF, o worker DEVE chamar OpenRouter `/chat/completions` com `type: "file"` e engine `native`.
- Quando o PDF nativo falhar por incompatibilidade/erro de parsing, o worker PODE cair para extração local via MarkItDown para preservar ingestão.
- Quando o job for documento não-PDF suportado, o worker DEVE converter para Markdown com MarkItDown e analisar o texto com o modelo documental configurado.
- Quando a análise documental retornar texto, o sistema DEVE persistir um `Transcript` com `source=UPLOAD`, `transcriptionMethod=DOCUMENT`, markdown canônico e texto pesquisável.
- Quando houver custo/tokens retornados pela OpenRouter, o sistema DEVE inserir `CostEvent(kind=DOCUMENT)` com `model`, tokens e custo.

### Modelos e setup

- O setup DEVE listar modelos documentais separados dos modelos de chat/transcrição/visão.
- A lista documental DEVE ser filtrada por modelos da OpenRouter que declaram entrada de arquivo/PDF (`architecture.input_modalities` contendo `file`) e saída de texto.
- O setup DEVE salvar `default_document_model`.
- O sistema NÃO DEVE considerar setup de imagem/documentos obrigatório para concluir o setup inicial, mas DEVE bloquear jobs de documento se o modelo documental estiver ausente.

### Menções de biblioteca no chat

- A UI do chat DEVE oferecer autocomplete ao digitar `@`.
- O backend DEVE validar cada menção pelo `userId` antes de enviar contexto ao chat service.
- O chat service DEVE receber contexto estruturado das menções e injetá-lo no prompt sem depender de texto livre confiável.
- Se o usuário remover a menção do texto antes de enviar, a UI NÃO DEVE enviar a referência stale.

### YouTube e bloqueio anti-bot

- O wrapper yt-dlp DEVE usar parâmetros conservadores de retry e clientes YouTube alternativos.
- O worker DEVE aceitar configuração cifrada de proxy/cookies/user-agent quando disponível.
- O sistema NÃO DEVE depender de listas públicas automáticas de proxies sem curadoria, por risco de segurança, instabilidade e bloqueio de conta.
- Em bloqueios persistentes, a mensagem DEVE explicar que o admin pode configurar cookies/proxy ou que o usuário pode enviar upload.

### Telegram

- O bot DEVE reconhecer PDF, DOCX, PPTX, XLS/XLSX, CSV, JSON, XML, HTML, Markdown, TXT e EPUB como documentos.
- O sistema NÃO DEVE aceitar ZIP ou formatos legados sem conversor validado (`.doc`, `.ppt`, `.rtf`) para evitar falhas tardias e risco de descompressão excessiva.
- O bot DEVE manter imagens como análise visual e mídia como transcrição.

### UI e estrutura de agentes

- O ícone de busca em `/grafo` DEVE permanecer visível acima do input.
- `.agents` DEVE espelhar agentes, skills, README e settings compartilháveis de `.claude`, sem copiar `settings.local.json`.

## Fora de escopo

- OCR local pesado com binários adicionais.
- Integração com serviços públicos de proxy não controlados.
- Garantia de download para vídeos privados, com login obrigatório ou bloqueados pela plataforma.
- Renomear toda a área "Transcrições" para "Biblioteca" nesta entrega.

## Validação

- Testes unitários/integração de upload web devem cobrir documentos.
- Testes do Telegram devem cobrir PDF como documento.
- Testes do renderer devem cobrir método `DOCUMENT`.
- Typecheck/lint/test/build devem ser executados antes da PR.
- Mudanças visuais devem ser verificadas com Playwright quando o ambiente estiver disponível.
