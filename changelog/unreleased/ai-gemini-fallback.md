---
tipo: feat
titulo_en: Gemini provider, per-role model fallback and reasoning effort
titulo_pt_br: Provedor Gemini, fallback de modelos por papel e esforço de raciocínio
---

Google Gemini joins the AI providers for text, vision and speech-to-text (Gemini 3.5 Flash-Lite, 3.8 Flash and 3.5 Transcribe), with a notice that free-tier keys may let Google use submitted content. Each role now keeps an ordered list of up to four models: when one fails (auth, quota, rate limit, timeout, retired model), the next one answers, and the cost of every attempt is counted. Reasoning is now on for every provider: each text role has an effort setting (off, low, medium or high, default medium), and reasoning tokens get their own output allowance and are counted in the cost. Existing single-model settings keep working unchanged.

<!-- pt-BR -->

O Google Gemini entra nos provedores de IA para texto, visão e transcrição (Gemini 3.5 Flash-Lite, 3.8 Flash e 3.5 Transcribe), com um aviso de que chaves do plano gratuito podem permitir ao Google usar o conteúdo enviado. Cada papel agora guarda uma lista ordenada de até quatro modelos: quando um falha (chave, cota, limite de taxa, tempo esgotado, modelo retirado), o próximo responde, e o custo de todas as tentativas é contado. O raciocínio agora fica ligado em todos os provedores: cada papel de texto tem um nível de esforço (desligado, baixo, médio ou alto, padrão médio), e os tokens de raciocínio ganham uma margem própria de saída e entram no custo. As configurações antigas de um modelo só continuam funcionando sem mudança.
