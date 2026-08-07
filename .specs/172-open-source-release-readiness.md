# Spec 172 — Prontidão para divulgação open source

## Contexto

O repositório será divulgado publicamente como um produto self-hosted. A
superfície pública precisa representar o runtime real, apresentar o produto com
imagens versionadas, oferecer fluxos verificáveis de instalação e contribuição,
eliminar artefatos legados e promover apenas uma versão validada para `main`.

Esta spec consolida o gate final de divulgação. Ela cobre documentação,
dependências, metadados do repositório, packages de container e release estável.

## Glossário

- **Imagem combinada**: `ghcr.io/yefclub/voxen`, que executa web/API, agente de
  chat integrado e worker no mesmo container.
- **Package legado**: `voxen-chat`, `voxen-web` ou `voxen-worker`.
- **Superfície pública**: README, documentação, metadados do GitHub, templates,
  releases, packages e instruções de instalação.

## Requisitos

### Ubiquitous

- The system shall document the current integrated TypeScript chat runtime and
  the Python worker without presenting the removed `apps/chat` service as
  active.
- The system shall display sanitized versions of the supplied Library and Chat
  screenshots near the beginning of the root README using repository-owned
  assets and descriptive alternative text, without personal or production
  knowledge-base data.
- The system shall keep all active production dependencies at patched versions
  when a compatible patched release exists.
- The system shall keep repository contribution, support, security, issue and
  release instructions mutually consistent and English-first.
- The system shall expose only `voxen` and the optional
  `voxen-proxy-agent` packages as supported container artifacts.
- The system shall enforce least-privilege GitHub workflow defaults and the
  documented squash-only merge policy through versioned repository settings.

### Event-driven

- When a stable release is merged into `main`, the system shall create a stable
  SemVer tag and publish only the combined Voxen application image.
- When a contributor validates a change, the system shall provide working
  commands for formatting, linting, type checking, tests and container builds.
- When repository settings drift, the system shall report the exact managed
  field, topic or Actions permission that differs.

### State-driven

- While a dependency advisory has no compatible upstream fix and its affected
  feature is not used by Voxen, the system shall retain a documented,
  time-bounded risk acceptance in the security gate.
- While the repository is public, the system shall keep private vulnerability
  reporting, branch protection, Discussions and issue forms enabled.

### Optional

- Where a VPS requires residential media egress, the system shall document and
  publish `voxen-proxy-agent` as a separate optional image.

### Unwanted behavior

- If public documentation references a removed runtime, command or local file,
  then the system shall fail the open-source readiness contract.
- If a legacy package remains in the GitHub Packages catalog, then the package
  shall be deleted together with all of its versions.
- If CI, security review, release publication or production health validation
  fails, then the release shall not be declared ready for public disclosure.

## Critérios de Aceite

- [ ] As duas imagens fornecidas estão sanitizadas, versionadas e renderizadas
      no README sem dados pessoais ou da base de produção.
- [ ] README, documentação EN/PT-BR, `CLAUDE.md` e Dependabot não descrevem
      `apps/chat` como serviço ativo.
- [ ] O contrato automatizado valida assets, links locais, runtime documentado,
      dependências corrigidas e configurações públicas essenciais.
- [ ] `pnpm audit`, `pip-audit`, CodeQL, Trivy, Bandit e gitleaks não apresentam
      vulnerabilidade explorável de severidade alta ou crítica no runtime atual.
- [ ] Configurações versionadas e configurações reais do GitHub estão alinhadas.
- [ ] `voxen-chat`, `voxen-web` e `voxen-worker` foram excluídos do GHCR.
- [ ] `voxen` e `voxen-proxy-agent` continuam públicos e funcionais.
- [ ] O checklist completo local e todo o CI remoto passam.
- [ ] A revisão independente aprova tanto a correção em `dev` quanto a release.
- [ ] A release estável está em `main`, a tag e os artefatos foram publicados e
      os endpoints de saúde de produção respondem com sucesso.

## Fora de Escopo

- Criar um serviço SaaS hospedado ou cadastro público irrestrito.
- Produzir novos vídeos, GIFs ou screenshots além dos dois assets fornecidos.
- Alterar a arquitetura funcional do agente, worker ou modelo de dados.
- Resolver atualizações de dependências sem relação com segurança ou prontidão
  pública quando exigirem migração de produto independente.

## Riscos / Decisões pendentes

- A exclusão dos packages legados é destrutiva e foi autorizada explicitamente
  pelo owner nesta solicitação.
- O alerta de React Router relacionado a RSC não possui correção compatível na
  linha publicada usada pelo projeto; Voxen usa apenas `BrowserRouter` e não
  ativa RSC. A exceção deve permanecer explícita, revisável e com prazo.
- A promoção `dev` → `main` e os merges necessários foram autorizados pelo owner
  para este gate final.
