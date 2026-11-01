# Fixture: inventário parcial

- `snapshot`: árvore de trabalho atual.
- `classe`: **cobertura parcial declarada**
- `incluído`: `apps/web/src/routes/mcp-*.ts`, `apps/web/src/lib/mcp-*.ts`, `scripts/agent-*.mjs`.
- `excluído`: `apps/web/src/client/**` (UI fora do escopo desta passada), histórico Git além de 50 commits.
- `não lido`: `apps/web/src/client/pages/transcricoes.tsx` (marcado como lacuna, não silenciado).
- `regra`: cobertura parcial declarada como total invalida o relatório inteiro.
