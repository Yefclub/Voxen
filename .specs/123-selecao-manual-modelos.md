# 123 — Seleção manual de modelos por finalidade

## Contexto

A spec 118 (2026-07-30) removeu a seleção manual de modelo do onboarding em
favor de uma "configuração unificada": o usuário só informa a chave da
OpenRouter, e o sistema aplica automaticamente um único modelo de texto
canônico (`x-ai/grok-4.5`) para chat/busca-web/visão/documento/análise-X, e
um modelo de transcrição canônico (`x-ai/grok-stt-1.0`) — ver
`apps/web/src/lib/model-defaults.ts`.

Essa decisão permanece válida para o onboarding (mantém o fluxo de "1
passo, só a chave"). Esta spec reintroduz a possibilidade de o
administrador **sobrescrever** qualquer um desses modelos canônicos
individualmente, sem reverter a simplicidade do onboarding — o
override é uma ação posterior, opcional, feita fora do fluxo inicial.

Local escolhido: página de integrações administrativas
(`admin-integracoes.tsx`), não o onboarding — é configuração de instância,
não passo obrigatório de setup, e segue o mesmo padrão de outras settings
GLOBAL admin-only já existentes ali (proxy, cookies da spec 121).

O componente `ModelPicker` (busca/filtro sobre o catálogo da OpenRouter,
diálogo com contagem de resultados) existia antes da spec 118
(`apps/web/src/client/components/model-picker.tsx`, removido no commit
`bd26187`) e serve de referência funcional — mas esta spec descreve
comportamento, a decisão de reaproveitar código ou reescrever é de
implementação.

## Glossário

- **Modelo canônico**: o modelo aplicado automaticamente por finalidade
  quando não há override (`DEFAULT_OPENROUTER_MODELS` em
  `model-defaults.ts`).
- **Finalidade de modelo**: cada uma das 6 chaves de settings hoje
  existentes — chat, transcrição, busca web, visão, documento, análise X.
- **Override**: valor de modelo escolhido manualmente pelo admin que
  substitui o canônico para uma finalidade específica.

## Requisitos

### Ubiquitous

- The system shall permitir que um usuário com role ADMIN sobrescreva,
  individualmente, o modelo usado em qualquer uma das finalidades
  existentes.
- The system shall manter o modelo canônico como valor padrão de cada
  finalidade sempre que não houver override explícito.
- The system shall listar apenas modelos do catálogo OpenRouter
  compatíveis com a finalidade (ex.: finalidade de transcrição só lista
  modelos com `output_modalities` incluindo `transcription`; finalidade de
  visão só lista modelos com `input_modalities` incluindo `image`).

### Event-driven

- When o admin seleciona um override de modelo para uma finalidade, the
  system shall validar que o modelo escolhido está disponível e é
  compatível com essa finalidade antes de persistir.
- When o admin remove um override (volta pro padrão), the system shall
  voltar a usar o modelo canônico daquela finalidade sem exigir nenhuma
  outra ação.
- When a chave da OpenRouter é revalidada/trocada, the system shall manter
  os overrides já configurados, revalidando apenas se ainda são
  compatíveis — nunca resetá-los silenciosamente para o canônico.

### Unwanted behavior

- If o admin tentar selecionar um modelo incompatível com a finalidade
  (ex.: modelo sem suporte a imagem na finalidade de visão), then the
  system shall rejeitar a seleção com mensagem explicando a
  incompatibilidade, sem persistir.
- If o catálogo da OpenRouter estiver indisponível no momento em que o
  admin abre a tela de seleção, then the system shall informar a
  indisponibilidade e preservar os overrides já persistidos (não apagar
  nada por falha de leitura do catálogo).

## Critérios de Aceite

- [x] Onboarding continua exatamente como está hoje (spec 118 intacta) —
      nenhuma escolha de modelo aparece no fluxo de setup inicial.
- [x] Página de integrações admin ganha seção de modelos com as 6
      finalidades, cada uma mostrando canônico vs. override ativo.
- [x] Seleção de modelo incompatível é bloqueada com mensagem clara.
- [x] Remover um override volta a finalidade para o modelo canônico.
- [x] Trocar a chave da OpenRouter não apaga overrides existentes.
- [x] Rota admin protegida por role ADMIN (mesmo padrão de
      `/api/admin/*` existente).

## Fora de Escopo

- Mudar o fluxo de onboarding em si.
- Adicionar novas finalidades de modelo além das 6 já existentes.
- Mudar a lógica de `hasCanonicalOpenRouterModels` usada na validação da
  chave durante o onboarding.

## Riscos / Decisões pendentes

- Nenhum override existe hoje em produção (a feature esteve ausente desde
  2026-07-30) — não há dado legado pra migrar, só o valor canônico atual
  de cada finalidade.

## Notas de implementação

- **Modelo de dados**: as 6 chaves de `Setting` (`default_chat_model`
  etc.) sempre guardam o modelo *efetivo* (canônico ou override) depois do
  primeiro setup — nunca ficam ausentes. "Há override?" é decidido
  comparando o valor armazenado com o canônico daquela finalidade
  (`stored !== canonical`). Reverter para o padrão grava o valor canônico
  de volta na mesma chave (não apaga a linha), preservando o invariante já
  assumido pelos consumidores atuais (`folder-classify.ts`,
  `tags-generate.ts`, `title-generate.ts`, `transcript-summary.ts`,
  `web-research.ts`, `jobs.ts`) de que essas chaves sempre têm valor.
- **`/api/setup` (troca de chave)**: passou a só preencher as 6 chaves de
  modelo que ainda não têm valor (write-if-absent), em vez de
  sobrescrevê-las sempre com o canônico. No primeiro setup nada existe
  ainda, então o comportamento é idêntico ao anterior (spec 118 intacta).
  Numa troca de chave posterior, valores já presentes — canônicos ou
  overrides — são preservados. Revalidação ativa de compatibilidade do
  override contra o catálogo da nova chave não foi implementada (a spec
  não define o que fazer em caso de incompatibilidade sem resetar
  silenciosamente); a tela de modelos é quem detecta isso na próxima
  interação.
- Rota nova: `apps/web/src/routes/admin-models.ts`, montada em
  `/api/admin/models` (`GET /`, `GET /catalog/:purpose`, `PATCH
  /:purpose`, `DELETE /:purpose`).
