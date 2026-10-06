---
tipo: security
titulo_en: Safer MCP credentials, permissions and result contracts
titulo_pt_br: Credenciais, permissões e resultados MCP mais seguros
---

Copied agent guidance no longer includes bearer secrets, and token lists expose only public metadata. New tokens default to READ and a 90-day expiry; users can explicitly choose write access or no expiry.

All 44 tools now declare scopes, effects and validated output schemas. READ credentials can monitor ingestion jobs. Large reads use signed, owner-bound JSON continuation; large write replies provide safe follow-up identifiers without a write continuation. Stable listing cursors survive inserts, edits and deletion.

MCP now bounds arguments, responses, concurrency and heavy graph queries, preserves authentication availability errors, emits safe diagnostics and prunes operational OAuth audit records. Connection guidance and the reported build version match the running application.

<!-- pt-BR -->

Instruções copiadas para agentes não incluem mais segredos Bearer, e listas de tokens retornam apenas metadados públicos. Novos tokens usam READ e validade de 90 dias por padrão; escrita e ausência de expiração exigem escolha explícita.

As 44 ferramentas agora declaram escopos, efeitos e schemas de saída validados. Credenciais READ acompanham jobs de ingestão. Leituras grandes usam continuação JSON assinada e vinculada ao usuário; respostas grandes de escrita fornecem identificadores de conferência sem repetir a escrita. Cursores de listagem permanecem estáveis após inserções, edições e exclusões.

O MCP limita argumentos, respostas, concorrência e consultas pesadas do grafo, diferencia falhas de disponibilidade da autenticação, registra diagnósticos seguros e limpa auditoria OAuth operacional. Instruções de conexão e versão informada correspondem à aplicação em execução.
