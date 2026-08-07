# Spec 178 — Publicação sincronizada da imagem de desenvolvimento

## Contexto

A tag `ghcr.io/yefclub/voxen:dev` deixou de acompanhar a branch `dev` depois que a
publicação automática em todo push foi desativada. A publicação não deve voltar a
ocorrer para commits intermediários: ela deve acontecer somente quando o bot de
versão concluir seu PR, pois esse é o ponto em que código, changelog e versão estão
sincronizados.

## Glossário

- **PR de versão**: PR automático que atualiza a versão de desenvolvimento após um merge.
- **Imagem dev**: imagem combinada publicada sob a tag mutável `ghcr.io/yefclub/voxen:dev`.
- **Tag estável**: tag `latest`, reservada a releases originadas de `main`.

## Requisitos

### Ubiquitous

- The system shall manter a tag `latest` independente de publicações da branch `dev`.
- The system shall manter disponível a publicação manual da imagem combinada.

### Event-driven

- When o PR automático de versão for mesclado em `dev`, the system shall publicar a imagem combinada a partir do commit de merge versionado.
- When a publicação for despachada, the system shall aguardar sua conclusão e registrar a execução no resumo do workflow de versão.

### State-driven

- While o PR de versão não estiver mesclado, the system shall não avançar a tag `dev`.

### Optional

- Where um mantenedor acionar o workflow manualmente, the system shall continuar publicando as tags compatíveis com a referência selecionada.

### Unwanted behavior

- If o dispatch, o build ou o push da imagem falhar, then the system shall falhar o workflow de versão com evidência da execução afetada.
- If um merge em `dev` ainda não tiver recebido seu commit de versão, then the system shall não publicar uma imagem intermediária como `dev`.

## Critérios de Aceite

- [ ] O workflow de versão despacha a publicação somente depois de confirmar o merge do PR automático.
- [ ] O workflow identifica a execução pelo SHA versionado e aguarda sucesso do build/push.
- [ ] A publicação resultante atualiza `dev`, a tag de versão e a tag imutável por SHA.
- [ ] A branch `dev` não é reintroduzida como trigger direto do workflow de imagem.
- [ ] A tag `latest` continua sendo publicada apenas por `main` ou por release estável.
- [ ] A documentação em PT-BR e inglês explica o novo ciclo de publicação.
- [ ] Um teste de contrato protege a ordem merge → dispatch → espera.

## Fora de Escopo

- Implantar automaticamente a imagem recém-publicada em instâncias Easypanel.
- Alterar a política de publicação de releases estáveis.
- Publicar novamente imagens legadas por componente.

## Riscos / Decisões pendentes

- A publicação aumenta a duração do workflow de versão, pois o resultado do build/push passa a fazer parte do gate.
- A tag `dev` é mutável; instalações que exigem reprodutibilidade devem usar a tag de versão ou SHA.
