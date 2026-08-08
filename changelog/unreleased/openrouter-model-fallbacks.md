---
tipo: fix
titulo_en: Resilient OpenRouter model fallbacks
titulo_pt_br: Fallbacks resilientes de modelos OpenRouter
---

OpenRouter rate limits are now treated as temporary failures with bounded retry
delays and a clear, actionable message. Administrators can configure one
compatible fallback for every AI model purpose, while initial setup suggests
safe alternatives automatically. Runtime usage and costs identify the model
that actually answered.

<!-- pt-BR -->

Os limites temporários da OpenRouter agora recebem novas tentativas com espera
controlada e uma mensagem clara e acionável. Administradores podem configurar
um fallback compatível para cada finalidade de modelo de IA, enquanto a
configuração inicial sugere alternativas seguras automaticamente. O uso e os
custos em runtime identificam o modelo que realmente respondeu.
