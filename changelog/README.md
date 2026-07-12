# Changelog

As novidades do Voxen são montadas a partir de **um arquivo por PR**, commitado
junto da mudança. Cada PR adiciona um arquivo `changelog/unreleased/<slug>.md`
descrevendo o que mudou **para o usuário final**.

No merge em `dev`, o workflow `version-dev` consome esses arquivos, carimba a
versão (`X.Y.Z-dev.<timestamp>`) e a data, move o conteúdo para `releases.json`
(página de **Novidades**) e remove o arquivo de `unreleased/`.

O CI **falha a PR** que não adicionar o arquivo (exceto PRs só de infra/docs/CI).

## Formato

```markdown
---
tipo: feat        # feat | fix | perf | ui | infra | security | chore
titulo: Título claro e descritivo, voltado ao usuário
---

Corpo em markdown **detalhado** — o que mudou, onde aparece na interface e por quê.
```

## Tipos

| tipo       | uso                         |
| ---------- | --------------------------- |
| `feat`     | nova funcionalidade visível |
| `fix`      | correção de bug             |
| `perf`     | melhoria de performance     |
| `ui`       | mudança visual / UX         |
| `infra`    | infra / DevOps / pipeline   |
| `security` | segurança                   |
| `chore`    | manutenção / interno        |

## Release de produção (dev → main)

Na PR de release, escreva **um** arquivo `changelog/RELEASE.md` curado:

```markdown
---
titulo: Voxen 0.11 — Biblioteca e versionamento
---

## Biblioteca

Cards compactos, pastas e organização com IA…

## Versionamento

Builds de dev agora exibem X.Y.Z-dev.timestamp…
```
