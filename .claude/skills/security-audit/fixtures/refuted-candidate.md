# Fixture: candidato refutado

- `snapshot`: árvore de trabalho atual.
- `classe`: **refutado**
- `candidato`: "Falta de rate limit no MCP expõe o servidor a DoS".
- `evidência contrária`: `docs/MCP.md` documenta 600 chamadas/minuto por usuário e o código aplica limites por owner/conexão/global com `Retry-After`; o teste de proteção cobre o comportamento.
- `verificação (2ª instância)`: **refutado** — a proteção existe e é observável; o candidato não vira achado final.
