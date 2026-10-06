---
tipo: feat
titulo_en: Modern MCP protocol with legacy client compatibility
titulo_pt_br: Protocolo MCP atual com compatibilidade para clientes anteriores
---

The MCP endpoint supports protocol revision 2026-07-28 through the maintained
official SDK while preserving 2025-era clients and JSON tool responses. Invalid
transport requests return protocol errors, request bodies are bounded to one
MiB, and per-request resources close on success, failure or cancellation.

<!-- pt-BR -->

O endpoint MCP suporta o protocolo 2026-07-28 pelo SDK oficial atualizado e
preserva os clientes de 2025 e as respostas JSON das ferramentas. Requisições
inválidas retornam erros de protocolo, os corpos têm limite de 1 MiB e os
recursos de cada chamada são fechados ao concluir, falhar ou cancelar.
