---
tipo: fix
titulo: Configuração simples e interface estável no uso diário
---

A configuração da OpenRouter passa a pedir somente a chave de API e aplica
automaticamente os modelos recomendados para conversa, análise e transcrição.
O processamento continua especializado por formato: PDFs usam o parser Mistral,
outros documentos usam MarkItDown e imagens, áudio e vídeo seguem pela
OpenRouter.

Notificações agora aparecem uma por vez durante cinco segundos. A Fila mantém
os dados visíveis e reconcilia mudanças em segundo plano, sem trocar a lista por
skeletons periódicos nem reiniciar itens que não mudaram.

No mobile, gestos horizontais em tabelas e conteúdos roláveis não abrem mais a
sidebar, e o menu fechado não deixa sombra na lateral. A atualização da
aplicação também passa a respeitar a versão exata do build e só ativa o novo
service worker quando a pessoa confirma.
