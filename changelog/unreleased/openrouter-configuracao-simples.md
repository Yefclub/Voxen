---
tipo: feat
titulo: OpenRouter pronta para uso com uma única chave
---

O onboarding agora pede somente a chave da OpenRouter e configura
automaticamente os modelos recomendados para conversa, transcrição, imagens,
documentos, pesquisa e conteúdo do X. O administrador continua podendo trocar
cada modelo depois na página de Configuração.

PDFs passam a usar o parser Mistral OCR pela OpenRouter. A geração automática de
tags também ficou mais confiável: respostas estruturadas evitam tags vazias e
conteúdos incompletos entram numa reconciliação em segundo plano, com tentativas
limitadas e diagnóstico preservado.
