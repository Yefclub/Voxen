---
tipo: fix
titulo_en: MinIO profile uses images published on Quay
titulo_pt_br: Perfil MinIO usa as imagens publicadas no Quay
---

The `minio/minio` and `minio/mc` repositories are no longer available on Docker
Hub, which broke the optional S3 profile, the CORS helper script, and the
Easypanel smoke test in CI. All references now pull the official images from
`quay.io/minio`.

<!-- pt-BR -->

Os repositórios `minio/minio` e `minio/mc` deixaram de existir no Docker Hub, o
que quebrava o profile opcional de S3, o script auxiliar de CORS e o smoke test
do Easypanel no CI. Todas as referências agora puxam as imagens oficiais do
`quay.io/minio`.
