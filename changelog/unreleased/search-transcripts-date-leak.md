---
tipo: fix
titulo: Busca no acervo quebrava o turno inteiro do chat
---

Corrigido bug que fazia o agente de chat falhar sempre que usava a ferramenta de busca no acervo (`search_transcripts`) — um campo de data era devolvido em formato incompatível com o que o modelo de IA espera, derrubando a resposta inteira com erro técnico. O mesmo problema foi corrigido no servidor MCP.
