# 124 — Fix: `createdAt` cru quebrava `search_transcripts` no chat e no MCP

## Contexto

Erro em produção (2026-07-31): toda vez que o agente do chat chamava a
tool `search_transcripts`, o turno inteiro falhava com
`AI_TypeValidationError`/`AI_InvalidPromptError` do AI SDK — Zod rejeitando
o histórico de mensagens que o próprio SDK monta internamente durante um
turno multi-step (raciocínio → tool-call → tool-result → próximo passo).

Causa raiz: `ftsSearchTranscripts` (`apps/web/src/lib/retrieval.ts`) usa
`db.$queryRaw` para a busca FTS e retorna `createdAt` como objeto `Date`
nativo (`FtsResult.createdAt: Date`). O tool `search_transcripts`
(`apps/web/src/lib/chat/runtime.ts`) repassava esse resultado sem
converter. O AI SDK exige que o `output` de uma tool seja um valor
JSON-safe (null/string/number/boolean/record/array) para poder serializar
o histórico multi-step — `Date` não é um desses tipos e a validação
explode, derrubando o turno inteiro do usuário.

Outras tools que retornam datas (`list_transcripts`, `list_notes`,
`read_transcript`, `search_notes`) já convertem com `.toISOString()`; só
`search_transcripts` (e o equivalente `voxen_search_transcripts` no
servidor MCP, `apps/web/src/routes/mcp.ts`, mesma função de origem) ficaram
de fora dessa conversão.

## Requisitos (EARS)

- **Ubiquitous**: toda tool do agente de chat DEVE retornar apenas valores
  JSON-safe (sem instâncias de `Date`) em seu resultado.
- **Event**: quando `search_transcripts` (chat) ou `voxen_search_transcripts`
  (MCP) retornam resultados de `ftsSearchTranscripts`, o campo `createdAt`
  de cada item DEVE ser serializado como string ISO-8601 antes de sair da
  tool.

## Critérios de Aceite

- [x] `search_transcripts` (runtime.ts) serializa `createdAt` antes de
      retornar.
- [x] `voxen_search_transcripts` (mcp.ts) serializa `createdAt` antes de
      retornar (mesma causa raiz, consistência com `voxen_list_transcripts`
      que já declara `createdAt: z.string()` no `outputSchema`).
- [x] Teste de integração (DB real) provando que o resultado da tool tem
      `createdAt` como string, não `Date` — regressão do bug real.
- [x] `make lint` / `make typecheck` sem erro.

## Fora de Escopo

- Auditoria completa de todo o restante das tools além das já verificadas
  nesta investigação (list_transcripts, list_notes, search_transcripts,
  read_transcript, request_transcription/getTranscriptBrief, related,
  verify_citations, get_job_status, search_notes, read_note, brain_search,
  propose_create_note — todas conferidas manualmente, só `search_transcripts`
  tinha o vazamento).
- Ampliar o `outputSchema` do MCP para expor `createdAt`/`folder`
  publicamente — fora do escopo deste fix pontual (mudaria o contrato
  público da tool MCP, decisão maior que uma correção de bug).
