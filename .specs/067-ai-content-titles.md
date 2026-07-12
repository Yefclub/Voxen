# 067 — Títulos de conteúdo avaliados/gerados por IA

## Contexto

Parte dos conteúdos (upload, X, scrape web) já gerava título por IA; o path
principal de vídeo (YouTube/Instagram/TikTok) usava só o título da plataforma.
Pedido: **sempre** passar o título candidato pela IA; se o título já for bom
editorialmente, a IA responde KEEP e o sistema mantém; senão, gera um novo.

## Glossário

- **título candidato**: título da plataforma, nome de arquivo, hostname ou
  placeholder gerado antes da avaliação.
- **KEEP**: resposta da IA indicando que o candidato deve ser mantido.

## Requisitos (EARS)

### Ubiquitous

- **R1** — The system shall avaliar o título de todo conteúdo persistido após a
  extração de texto (vídeo, upload, X, web scrape), usando o modelo de chat
  padrão e a chave OpenRouter configurada.
- **R2** — The system shall gravar no máximo um título final por conteúdo, com
  no máximo 90 caracteres sanitizados (sem aspas desnecessárias, sem quebras).

### Event-driven

- **R3** — When a IA responder `KEEP` (ou equivalente) ou devolver o mesmo título
  candidato, the system shall manter o título candidato.
- **R4** — When a IA devolver um título novo, the system shall usá-lo no
  Transcript, no frontmatter e no `.md`.
- **R5** — When a geração falhar (rede, auth, modelo ausente, texto &lt; 40
  chars), the system shall manter o título candidato e NÃO falhar o job.

### Unwanted

- **R6** — If a chave OpenRouter ou o modelo de chat estiverem ausentes, then
  the system shall pular a geração e usar o candidato.
- **R7** — If o conteúdo textual for vazio ou muito curto (&lt; 40 chars), then
  the system shall pular a geração e usar o candidato.

## Critérios de Aceite

- [ ] Path de vídeo chama a avaliação de título antes de persistir
- [ ] Upload / X / web continuam avaliando título
- [ ] Resposta KEEP mantém o candidato
- [ ] Falha best-effort não marca job FAILED
- [ ] Testes unitários cobrem payload, KEEP e título novo
- [ ] Custo registrado em CostEvent com `source: title_generation` quando a call ocorre

## Regeneração em lote (backfill)

Reprocessa os títulos do acervo existente com a mesma lógica de geração — útil
após corrigir a geração (idioma PT-BR e vazamento de reasoning).

- When o admin aciona "Regenerar títulos", the system shall reavaliar em lote os
  títulos das transcrições ACTIVE do usuário, uma chamada de IA por conteúdo,
  usando o mesmo prompt/decisão da geração (KEEP mantém títulos já bons).
- The system shall drenar o acervo em lotes via cursor estável
  (`createdAt desc, id desc`), sem repetir nem pular itens, e ser seguro em
  reexecução.
- While o backfill roda, the system shall escopar toda query por `userId`,
  persistir só quando o título muda, reindexar o Brain dos alterados e registrar
  CostEvent (`source: title_generation_backfill`) por item.
- When um lote inteiro falha (ex.: chave inválida), the system shall abortar o
  drain em vez de gastar créditos.
- The system shall confirmar com o usuário antes de iniciar (operação com custo).

### Critérios de Aceite (backfill)

- [ ] Endpoint em lote escopado por `userId`, idempotente por cursor
- [ ] Persiste só quando muda; reindexa Brain dos alterados; CostEvent por item
- [ ] Botão na biblioteca com confirmação de custo e drain por lotes
- [ ] Testes unitários cobrem a decisão de título (KEEP / preâmbulo / novo)

## Fora de Escopo

- UI de editar título
- Classificação em pastas (spec separada)

## Riscos

- IA pode substituir títulos bons se o prompt for fraco — mitigado por KEEP
- +1 call LLM barata por job de vídeo
