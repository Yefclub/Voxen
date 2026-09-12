# prisma — regras locais

Carrega automaticamente ao trabalhar em arquivos sob `prisma/`.
Regras globais do repositório continuam no `CLAUDE.md` da raiz.

## Migrations (CRÍTICO)

- Mudou `prisma/schema.prisma`? Criar migration: `pnpm prisma migrate dev --name <nome>`
- Em prod: `prisma migrate deploy` roda no startup do App Easypanel ou no entrypoint do `web` no Compose
- Colunas no schema sem migration passam no dev mas QUEBRAM no deploy
- Para mudanças complexas, SQL manual em migration: SEMPRE com `IF NOT EXISTS` / `IF EXISTS`
- SQL deve ser idempotente; usar locks para prevenir operações concorrentes
- **FTS**: o `tsvector` em `Transcript.searchVector` é gerenciado via trigger SQL — quando atualizar texto, garantir que a trigger ainda funciona
