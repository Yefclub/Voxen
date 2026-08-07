# Spec 171 — Descontinuação de imagens legadas de componentes

## Contexto

O Voxen suporta implantação atual por uma imagem combinada que executa web/API,
worker e runtime de chat integrado. Ainda assim, o fluxo de release publica
imagens públicas separadas de web e worker; junto da imagem de chat histórica,
isso cria um catálogo contraditório e induz instalações novas a uma topologia
não suportada.

A imagem combinada `voxen` e a imagem opcional `voxen-proxy-agent` permanecem
contratos públicos. Os packages de componentes e todas as suas versões
históricas serão excluídos do GHCR após a integração desta mudança.

## Glossário

- **Imagem combinada**: imagem pública `ghcr.io/yefclub/voxen` para a aplicação
  inteira.
- **Imagem de componente**: imagem histórica de web, worker ou chat publicada
  separadamente.
- **Proxy agent**: imagem pública opcional para egress residencial de mídia.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The release system shall publish the combined `voxen` image as the sole
  public application image.
- The release system shall retain `voxen-proxy-agent` as a separately published
  optional image.
- The release system shall not publish `voxen-web`, `voxen-worker`, or
  `voxen-chat` as current release images.
- The release notes shall list the combined image and shall not list component
  images as release artifacts.

### Event-driven (resposta a evento)

- When a stable version tag is published, the system shall create the GitHub
  release without pushing a component image to GHCR.
- When this change is integrated, the package administrator shall delete the
  existing component packages together with all historical versions.

### State-driven (durante um estado)

- While CI validates a pull request, the system shall continue building web and
  worker Dockerfiles without pushing any image to a registry.

### Optional (feature opcional)

- Where an operator needs residential media-extraction egress, the system shall
  continue to document and publish the proxy-agent image independently.

### Unwanted behavior (condições de erro)

- If a future edit reintroduces a component-image reference in the stable
  release publication surface, then the repository contract test shall fail.

## Critérios de Aceite

- [ ] O workflow de release não faz push nem lista `voxen-web`, `voxen-worker`
      ou `voxen-chat`.
- [ ] A release do GitHub lista somente a imagem combinada `voxen`.
- [ ] O teste de superfície impede regressão da publicação de componentes.
- [ ] CI continua construindo Dockerfiles de web e worker com `push: false`.
- [ ] Após integração, os três packages legados e todas as versões históricas
      foram excluídos; `voxen` e `voxen-proxy-agent` permanecem públicos.

## Fora de Escopo

- Remover Dockerfiles de web ou worker usados pelo Compose e pelo CI.
- Alterar a imagem combinada ou o proxy agent.

## Riscos / Decisões pendentes

- A exclusão dos packages legados é destrutiva e interrompe pulls de versões
  históricas; ela ocorre somente após o workflow deixar de republicá-las e foi
  autorizada explicitamente pelo owner.

> 2026-08-06: especificação criada a partir da autorização explícita do usuário
> para descontinuar com segurança o catálogo público de imagens legadas.
