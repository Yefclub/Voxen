# Fixture: achado confirmado

- `snapshot`: árvore de trabalho atual (`git status` limpo em `dev` não exigido; ver `git log --oneline -1` no relatório real).
- `classe`: **confirmado**
- `evidência`: `apps/web/src/routes/mcp-tool-execution.ts` — validação de `content_cursor` via HMAC com `timingSafeEqual` antes de qualquer lookup; cursor adulterado retorna `MCP_INVALID_CONTENT_CURSOR` sem tocar no cache.
- `alcance`: chamador com token válido de outro owner reutilizando um cursor assinado para outro `userId`.
- `impacto`: leitura cross-workspace contida no fail-closed; sem vazamento.
- `verificação (2ª instância)`: **confirmado** — releitura da fonte confirma HMAC owner/tool/args + checagem de owner/tool antes do lookup.
