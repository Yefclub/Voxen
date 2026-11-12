---
tipo: fix
titulo_en: Keep local speech-to-text available as a fallback
titulo_pt_br: Preserve a transcrição local como alternativa
---

Captures now request compatible audio whenever an available local speech
model appears in your provider chain, including after a cloud provider.
This lets eligible audio fall back to the configured local model without
changing your provider preference or existing media limits. Partial speech
and image failures now record their processing step and safe error code to
help diagnose incomplete captures.

<!-- pt-BR -->

As capturas agora solicitam áudio compatível quando um modelo local de fala
disponível aparece na sua cadeia de provedores, inclusive depois de um
provedor em nuvem. Assim, áudios compatíveis podem usar o modelo local como
alternativa, preservando sua ordem de preferência e os limites de mídia.
Falhas parciais de fala e imagem agora registram a etapa e um código seguro
para facilitar o diagnóstico de capturas incompletas.
