---
tipo: fix
titulo: Capas estáveis no S3 e deploy Easypanel só manual
---

Capas de vídeo/página (especialmente TikTok) deixam de apontar para CDN
assinada no navegador: na ingestão a imagem é espelhada no storage e a
UI usa só `/api/transcripts/:id/preview` (com placeholder se a CDN já
tiver bloqueado). Também dá para pedir `POST .../refresh-thumbnail`.

O script de deploy do Easypanel agora exige `VOXEN_ALLOW_DEPLOY=1` —
sem isso não dispara redeploy (auto-deploy desligado de verdade).
