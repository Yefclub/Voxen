# Título da PR (em PT-BR, sem emoji, sem rodapé de IA)

## Contexto

Por que essa mudança existe? Que problema resolve?

## O que foi feito

Lista clara das mudanças.

- Mudança 1
- Mudança 2

## Detalhes técnicos

Decisões, trade-offs, partes complicadas. Liste arquivos críticos modificados.

## Plano de testes

- [ ] `make lint` verde
- [ ] `make typecheck` verde
- [ ] `make test` verde
- [ ] `docker compose build` verde
- [ ] Dockerfile Easypanel validado pelo CI (`Docker build (apps + Easypanel)`)
- [ ] Spec atualizada/criada: `.specs/NNN-slug.md` (se aplicável)
- [ ] Migration Prisma criada (se mudou schema)
- [ ] Testado manualmente: <descrever cenários>

## Referências

- Issue: #N (se aplicável)
- Spec: `.specs/NNN-slug.md` (se aplicável)
- ADR: `docs/DECISIONS.md` ADR-N (se aplicável)
