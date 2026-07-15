# Spec 096 — Tags automáticas na ingestão (links/jobs)

## Contexto

A spec 075 entregou tags sob demanda (botão na biblioteca/detalhe). Na prática,
conteúdos adicionados por URL (YouTube/web/upload) chegavam **sem tags** — o
worker só gerava título, pasta e resumo. O owner reportou links sem tags e
enriquecimento automático incompleto.

## Requisitos

### Event-driven

- When um job de vídeo/áudio/X conclui o resumo (ou o tenta), the system shall
  gerar tags via o modelo de chat padrão se o transcript ainda não tiver tags.
- When um job SCRAPE_WEB conclui o resumo, the system shall fazer o mesmo.
- When tags válidas forem geradas, the system shall persistir Tag + TranscriptTag
  e aplicar R-FOLDER (pasta só se `folderId` vazio), com `CostEvent`
  `source: tag_generation_auto`.

### Unwanted

- If o texto/título forem curtos demais, then skip.
- If já existirem tags no transcript, then skip (não sobrescreve).
- If a geração falhar, then o job ainda marca DONE (best-effort).

## Critérios de Aceite

- [ ] Worker gera tags após summary em pipelines de vídeo e scrape
- [ ] Helpers puros de slug/resolve cobertos por testes
- [ ] Spec 075 atualizada: auto-ingest deixa de ser “fora de escopo”
- [ ] Changelog unreleased

## Fora de Escopo

- Backfill em massa de conteúdos antigos sem tag (já existe botão em lote na UI)
- Mudar o classificador de pasta (continua rodando no persist)
