# apps/worker — regras locais

Carrega automaticamente ao trabalhar em arquivos sob `apps/worker/`.
Regras globais do repositório continuam no `CLAUDE.md` da raiz.

## Formato `.md` de transcrição

O worker é quem **gera** o `.md` canônico (`src/transcript_md.py`). Cada vídeo transcrito vira um `.md` com frontmatter YAML + corpo com timestamps clicáveis. Schema completo em `docs/TRANSCRIPT-FORMAT.md` — mudou o formato, atualiza o doc no mesmo PR. O texto puro + frontmatter são espelhados em Postgres pra FTS rápida, então mudança de schema afeta a busca.
