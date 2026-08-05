# Spec 170 — Documentação de implantação unificada no Easypanel

## Contexto

O Voxen publica uma imagem combinada para executar a aplicação. A documentação
em inglês já indica a imagem, mas não explica toda a topologia; a documentação
em PT-BR ainda abre a seção do Easypanel recomendando Dockerfile e usa nomes de
serviços que não correspondem à arquitetura atual. Isso torna a instalação mais
difícil e pode induzir o operador a criar serviços de aplicação desnecessários.

Esta especificação consolida o caminho recomendado: uma única imagem da
aplicação Voxen, dependências de dados gerenciadas separadamente e o agente de
proxy residencial apenas quando necessário.

## Glossário

- **Imagem combinada**: a imagem `ghcr.io/yefclub/voxen`, que executa a web/API,
  worker e runtime de chat integrados.
- **Serviços de dados**: PostgreSQL, Redis e MinIO/S3, provisionados fora do
  container da aplicação para preservar dados e permitir backups.
- **Agente de proxy residencial**: container opcional para extração de mídia
  por IP residencial quando o Voxen está numa VPS/datacenter.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The documentation shall present the published combined Voxen image as the
  recommended Easypanel application deployment source.
- The documentation shall state that one Voxen App runs the web/API, worker and
  integrated chat runtime.
- The documentation shall state that PostgreSQL, Redis and MinIO/S3 are
  separate persistent dependencies, not separate Voxen application images.
- The documentation shall use the current runtime terminology and shall not
  describe a separate current `voxen-chat` service.
- The documentation shall identify `latest` as the stable-image tag and `dev`
  as the integration-image tag.

### Event-driven (resposta a evento)

- When an operator follows the Easypanel instructions, the documentation shall
  provide the image, exposed port, health-check path, required service topology
  and runtime environment variables.
- When an operator deploys on a VPS/datacenter, the documentation shall explain
  that the residential proxy agent is optional and runs separately only to
  route media extraction traffic.

### State-driven (durante um estado)

- While an operator chooses the recommended image source, the documentation
  shall state that secrets are configured at runtime and do not participate in
  the application image build.

### Optional (feature opcional)

- Where an operator deliberately uses repository/Dockerfile source mode for a
  test environment, the documentation shall mark it as non-recommended and
  explain its build-time secret exposure risk.

### Unwanted behavior (condições de erro)

- If documentation lists historical or legacy images, then the documentation
  shall explicitly prevent readers from treating them as required current
  application services.

## Critérios de Aceite

- [ ] README em inglês identifica corretamente a única imagem e seus processos
      integrados.
- [ ] Guias inglês e PT-BR orientam uma topologia de um App Voxen e três
      serviços de dados persistentes.
- [ ] Guias informam imagem, tags, porta, health check, variáveis e validação
      pós-deploy.
- [ ] Guias descrevem o proxy residencial como opcional e independente.
- [ ] Nenhum guia recomenda Dockerfile como caminho padrão nem indica um chat
      service atual separado.

## Fora de Escopo

- Alterar Dockerfiles, entrypoint ou a composição dos containers publicados.
- Criar um instalador automático ou alterar a interface do Easypanel.
- Alterar a imagem opcional `voxen-proxy-agent`.

## Riscos / Decisões pendentes

- As tags `dev` e `latest` dependem dos workflows de publicação existentes;
  este trabalho documenta o contrato atual sem mudar seu acionamento.

> 2026-08-05: especificação registrada com a autorização prévia do usuário para
> concluir as melhorias de documentação e README relacionadas à instalação.
