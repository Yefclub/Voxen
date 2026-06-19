# 051 — Mover strings hardcoded para i18n (apps/web)

## Contexto

Uma auditoria do frontend (`apps/web`) identificou strings de UI escritas
diretamente no JSX/atributos/erros (literais hardcoded) que **não passam pelo
`t()`** do sistema de i18n (`apps/web/src/client/lib/i18n.tsx`). Como o Voxen
suporta dois idiomas (pt-BR e en), essas strings ficavam fixas em português (ou
montadas de forma frágil) e **não traduziam** quando o usuário escolhia inglês.

O caso de maior impacto era o título da tela de setup, que era montado com
`t('setup.title.initial').replace('OpenRouter', '')` + um `<span>` colorido. Essa
abordagem dependia da posição exata da palavra "OpenRouter" na string traduzida e
quebraria o título no inglês caso a tradução mudasse de estrutura.

Esta spec cobre apenas **extração de strings** para o i18n: criação de chaves nos
dois locales e substituição do literal por `t('chave')`. NÃO há mudança de lógica,
estado, layout ou comportamento de fetch. Quando já existia chave equivalente, ela
foi reusada em vez de duplicada.

## Requisitos (EARS)

- **Ubíquo** — O sistema DEVE renderizar todo texto de UI listado abaixo via
  `t()`, resolvendo o idioma corrente (pt-BR ou en).
- **Dirigido por evento** — QUANDO o usuário alterna o idioma para inglês, o
  sistema DEVE exibir as strings movidas em inglês.
- **Estado** — ENQUANTO o título inicial da tela de setup é exibido, o sistema
  DEVE compor o título como prefixo traduzido + "OpenRouter" destacado + sufixo
  traduzido, sem depender de `replace()` sobre a string traduzida.
- **Ubíquo** — O sistema NÃO DEVE alterar a lógica, o layout ou o comportamento
  de nenhum componente afetado; apenas a origem do texto muda.

## Strings movidas

| # | Arquivo | Texto original | Chave i18n |
|---|---------|----------------|------------|
| 1 | `pages/setup.tsx` | `t('setup.title.initial').replace('OpenRouter', '')` + span | `setup.title.initialPrefix` + `setup.title.initialSuffix` (novas; `setup.title.initial` removida por ficar morta) |
| 2 | `pages/onboarding.tsx` | `'Erro ao enviar imagem.'` | `onboarding.error.avatar` (reuso de chave existente) |
| 3 | `components/ui/prompt-box.tsx` | `` `Remover ${item.label}` `` | `prompt.removeMention` (nova, interpolação `{label}`) |
| 4 | `pages/jobs.tsx` | `Link` (label do campo de URL) | `jobs.mode.link` (reuso de chave existente) |
| 5 | `pages/jobs-detalhe.tsx` | `Job` (eyebrow do cabeçalho) | `jobDetail.eyebrow` (nova) |
| 6 | `pages/admin-custos.tsx` | `tokens` | `admin.costs.tokens` (nova) |
| 7 | `pages/admin-integracoes.tsx` | `'Falha ao copiar.'` | `admin.integrations.copyError` (nova) |
| 8 | `pages/setup.tsx` | `placeholder="sk-or-v1-... (opcional)"` | `setup.openrouter.newKeyPlaceholder` (nova) |
| 9 | `pages/setup.tsx` | `placeholder="admin@seudominio.com"` | `setup.operation.adminEmailPlaceholder` (nova) |
| 10 | `pages/setup.tsx` | `placeholder="http://usuario:senha@host:porta&#10;socks5://host:porta"` | `setup.operation.proxyPlaceholder` (nova) |

### Notas de implementação

- **#7**: a mensagem é lançada num helper `writeClipboardText` (módulo, fora de
  React, sem acesso a `t()`). A string traduzida passa a ser recebida por
  parâmetro; ambos os callers (`copyToken`, `copyAgentPrompt`) passam
  `t('admin.integrations.copyError')`. O fluxo de erro existente é preservado.
- **#10**: o valor da chave mantém a entidade literal `&#10;` exatamente como no
  placeholder original (string de atributo JSX), preservando a renderização.

## Fora de escopo

- Strings internas nunca exibidas ao usuário (logs, mensagens de erro
  consumidas/ignoradas internamente além das listadas).
- Cobertura 100% de i18n de toda a aplicação — esta entrega foca nas strings
  visíveis ao usuário levantadas pela auditoria e suas vizinhas óbvias.
