---
tipo: feat
titulo: Escolha manual de modelo por finalidade nas integrações admin
---

A configuração da OpenRouter continua exigindo só a chave no onboarding,
mas agora o admin pode sobrescrever individualmente o modelo usado em cada
uma das 6 finalidades (chat, transcrição, busca na web, visão, documentos
e análise do X) em **Integrações**.

A nova seção mostra o modelo padrão e o override ativo de cada finalidade,
com um diálogo de busca sobre o catálogo da sua chave OpenRouter — a lista
já vem filtrada pelos modelos compatíveis com aquela finalidade (ex.: só
modelos com suporte a imagem aparecem na finalidade de visão). Tentar
escolher um modelo incompatível é bloqueado com uma mensagem explicando o
motivo, e um botão "Voltar ao padrão" remove o override a qualquer
momento. Trocar a chave da OpenRouter não apaga overrides já configurados.
