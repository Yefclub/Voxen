---
tipo: fix
titulo_en: More reliable TikTok and web imports
titulo_pt_br: Importações do TikTok e da web mais confiáveis
---

TikTok imports use an updated extractor to restore downloads affected by recent
changes to public video pages.

Temporary connection failures, web timeouts and source request limits now receive
bounded automatic retries. Imports with long cooldowns return to the queue so
other content can continue processing. If the source remains unavailable, Voxen
explains that automatic attempts ended and offers retry or manual upload.

Network and document-processing dependencies also receive compatible security
updates. Source access restrictions and safety checks remain enforced.

<!-- pt-BR -->

As importações do TikTok usam um extrator atualizado para recuperar downloads
afetados por mudanças recentes nas páginas de vídeos públicos.

Falhas temporárias de conexão, timeouts da web e limites de requisições recebem
novas tentativas automáticas com limite. Importações com esperas longas voltam à
fila para permitir o processamento de outros conteúdos. Se a fonte continuar
indisponível, o Voxen informa que as tentativas terminaram e orienta tentar mais
tarde ou enviar o conteúdo por upload manual.

As dependências de rede e processamento de documentos também recebem
atualizações de segurança compatíveis. As restrições de acesso às fontes e
verificações de segurança são mantidas.
