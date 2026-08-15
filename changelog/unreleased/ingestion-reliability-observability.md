---
tipo: fix
titulo_en: More reliable reprocessing, duplicate prevention, and diagnostics
titulo_pt_br: Reprocessamento, prevenção de duplicatas e diagnósticos mais confiáveis
---

Voxen now recognizes TikTok short links and their canonical URLs as the same source before creating or retrying jobs, preventing duplicate processing even under concurrent requests. Complementary research also tolerates provider responses that contain valid citations but omit the search-usage field, while preserving conservative cost accounting.

Application diagnostics are now emitted as safe, structured JSON with request and job correlation fields. A new operational collector can filter copied Docker or Easypanel logs by time, service, severity, event, job, request, or error code without exposing provider payloads or credentials.

<!-- pt-BR -->

A Voxen agora reconhece links curtos do TikTok e suas URLs canônicas como a mesma fonte antes de criar ou reprocessar jobs, evitando processamento duplicado mesmo em solicitações concorrentes. A pesquisa complementar também tolera respostas do provedor com citações válidas, mas sem o campo de uso da busca, mantendo uma contabilização conservadora de custos.

Os diagnósticos da aplicação agora são emitidos como JSON estruturado e seguro, com campos de correlação por requisição e job. Um novo coletor operacional permite filtrar logs copiados do Docker ou Easypanel por período, serviço, severidade, evento, job, requisição ou código de erro sem expor payloads de provedores ou credenciais.
