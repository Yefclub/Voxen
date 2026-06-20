# Spec 033 — Mídia interna, chat contextual e polish mobile

## Contexto

Uploads diretos criam conteúdo interno que não existe em uma URL pública original. Hoje o arquivo é usado para processamento e depois deixa de ser acessível pela interface, o que quebra o histórico da transcrição. A experiência mobile também precisa reduzir atrito: títulos não podem vazar da tela, a aplicação não deve permitir rolagem horizontal e a transição entre telas deve parecer nativa no PWA.

## Escopo

- Persistir arquivos enviados por upload no storage S3/MinIO quando o job termina com transcrição/análise.
- Expor URL segura e autenticada para mídia original de uploads vinculada à transcrição.
- Garantir imagem de preview para conteúdos com thumbnail externa, imagem enviada, vídeo enviado, documento/página sem imagem e fallback consistente.
- Gerar títulos por IA para fontes `UPLOAD`, `WEB` e `X` quando o título inicial for genérico ou ruim.
- Substituir o CTA fixo "Conversar sobre esta transcrição" por um botão flutuante de chat na página da transcrição aberta.
- Corrigir overflow horizontal e truncamento/containment de títulos no mobile.
- Implementar View Transitions em navegação SPA com fallback automático quando a API não estiver disponível.

## Requisitos funcionais

- Ao criar uma transcrição a partir de upload, o arquivo original deve continuar disponível para o usuário dono da transcrição.
- O acesso ao arquivo original deve passar pela API autenticada; URLs S3 internas ou segredos não devem ir para o cliente.
- Para imagem enviada, o preview deve ser a própria imagem original.
- Para vídeo enviado, o preview deve ser uma imagem estável gerada do vídeo quando `ffmpeg` estiver disponível; se falhar, usar fallback visual.
- Para página web e X, o worker deve tentar extrair metadados de preview/título e complementar com título IA.
- A página de detalhe da transcrição deve ter um FAB de chat que abre um painel contextual na própria tela, sem navegar para `/chat`.
- O chat contextual deve enviar `transcriptId`/contexto para o backend existente e preservar streaming.
- View Transitions devem ser progressivas: `document.startViewTransition()` quando suportado, navegação normal quando não suportado.

## Requisitos de segurança

- Nunca expor objeto S3 bruto por URL pública permanente.
- Validar ownership de `transcriptId` antes de servir mídia original.
- Manter limites atuais de upload e validação de MIME.
- Não confiar em filename do usuário para paths finais; usar IDs do job/transcript e nomes sanitizados.

## Critérios de aceite

- Testes TS/worker cobrem metadata persistida e endpoints de mídia.
- Typecheck/lint/build passam.
- Verificação visual mobile cobre `/jobs`, `/transcricoes`, `/transcricoes/:id` e painel de chat flutuante.
- Em viewport mobile, não há `document.documentElement.scrollWidth > window.innerWidth`.
- Navegação SPA usa View Transition em browsers compatíveis e não quebra em browsers sem suporte.
