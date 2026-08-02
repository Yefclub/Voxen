# Spec 142 — Extração grounded do Brain por seção e timestamp

## Contexto

A extração grounded do Brain hoje considera apenas o início de um conteúdo. Em conteúdos longos, entidades e claims das partes posteriores deixam de ser indexados e a evidência não informa uma localização navegável.

Esta spec torna a compilação incremental, preserva a proveniência literal e permite retomar somente as seções que não foram concluídas. Relaciona-se à issue #540.

## Glossário

- **Segmento:** parte contígua de um conteúdo delimitada por título, bloco ou marcação de tempo e com tamanho processável.
- **Cobertura:** conjunto de segmentos de uma versão do conteúdo que já tiveram a extração concluída.
- **Localização:** intervalo de linhas e, quando disponível, de segundos associado a uma evidência.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall dividir todo conteúdo elegível em segmentos contíguos cuja concatenação cubra o conteúdo completo, sem limitar a extração ao prefixo do documento.
- The system shall preservar em cada entidade e claim aceitos um trecho literal contíguo do segmento de origem.
- The system shall persistir para cada evidência o intervalo de linhas e, quando o conteúdo tiver marcação temporal, o intervalo de segundos correspondente.
- The system shall expor para cada conteúdo o estado de compilação `PENDING`, `PARTIAL`, `COMPLETED`, `FAILED` ou `SKIPPED`.
- The system shall manter itens manuais e evidências de outros métodos ao atualizar a compilação grounded.

### Event-driven (resposta a evento)

- When um conteúdo elegível for concluído ou reprocessado, the system shall iniciar ou atualizar sua compilação grounded por segmento.
- When um segmento for concluído, the system shall materializar somente as entidades, claims e evidências daquele segmento e registrar sua cobertura.
- When o conteúdo mudar, the system shall invalidar a cobertura anterior e recompilar os segmentos da nova versão.
- When uma evidência for consultada pelo Brain, the system shall retornar sua localização navegável junto do trecho literal.

### State-driven (durante um estado)

- While existirem segmentos pendentes ou com falha recuperável, the system shall reportar o estado `PARTIAL` após ao menos um segmento concluído e `PENDING` antes da primeira tentativa concluída.
- While todos os segmentos da versão atual estiverem concluídos, the system shall reportar o estado `COMPLETED`.

### Optional (feature opcional)

- Where o conteúdo não possuir marcações temporais, the system shall persistir a localização por linhas sem inventar timestamps.
- Where não houver configuração de IA disponível, the system shall reportar `SKIPPED` sem falhar a ingestão do conteúdo.

### Unwanted behavior (condições de erro)

- If uma seção falhar na extração, then the system shall registrar a falha daquele segmento, preservar os segmentos já concluídos e permitir nova tentativa somente do segmento falho.
- If a resposta do modelo contiver um trecho que não seja literal no segmento, then the system shall descartar o item e não materializar evidência.
- If uma execução repetida receber conteúdo inalterado, then the system shall não duplicar evidências nem apagar dados manuais.

## Critérios de Aceite

- [ ] Um conteúdo acima do limite anterior tem segmentos após o prefixo processados.
- [ ] A evidência de item extraído informa linhas e timestamps quando existirem no conteúdo.
- [ ] Reexecução da mesma versão não duplica evidências grounded.
- [ ] Falha em um segmento preserva itens anteriores e a próxima execução tenta somente o segmento pendente ou falho.
- [ ] Alteração do conteúdo reinicia a cobertura para sua nova versão.
- [ ] Ausência de configuração de IA não falha o job de ingestão e expõe `SKIPPED`.
- [ ] Testes cobrem segmentação, grounding, localização, idempotência e falha parcial.

## Fora de Escopo

- Inferir relações semânticas, suporte ou contradições entre claims (issue #541).
- Alterar o mecanismo de retrieval ou o ranking de busca (issue #539).
- Reprocessar em massa conteúdos existentes sem uma ação de reindexação.

## Riscos / Decisões pendentes

- O modelo pode retornar poucos itens por segmento; a cobertura mede segmentos processados, não quantidade de itens aceitos.
- A localização temporal depende de marcadores presentes no conteúdo e não deve ser estimada quando ausente.
