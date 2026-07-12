---
tipo: fix
titulo: Agente in-app ganha ferramenta para enfileirar transcrição de links compartilhados
---

O agente respondia que não tinha acesso à internet e não conseguia abrir links quando o usuário colava uma URL do YouTube, X ou qualquer página — apesar do Voxen ser justamente uma plataforma de ingestão de links. A causa era a falta de uma ferramenta de enfileiramento: o agente só enxergava tools de leitura sobre o que já estava transcrito no acervo. Agora ele também tem `request_transcription` (enfileira a URL nova, ou aponta direto a transcrição já existente) e `get_job_status` (acompanha o job até concluir), espelhando o par que o servidor MCP já usava para agentes externos.
