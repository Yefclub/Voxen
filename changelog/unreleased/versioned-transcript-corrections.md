---
tipo: feat
titulo_en: Correct transcripts without changing original evidence
titulo_pt_br: Corrija transcrições sem alterar a evidência original
---

Transcript details now include a reviewable correction layer for exact replacements and
insertions. Every accepted change creates an immutable revision, keeps the captured source
untouched, detects concurrent edits, and can be inspected, restored, or reset from the web
interface. Search, summaries, chat retrieval, and grounded graph compilation consume the active
correction while preserving source provenance.

The integrated assistant can propose a bounded correction preview that always requires explicit
approval. MCP clients with write scope receive the same revision-aware correction and restore
operations; read-only tokens can search and inspect correction history without gaining mutation
access.

<!-- pt-BR -->

Os detalhes da transcrição agora incluem uma camada revisável de correções para substituições e
inserções exatas. Cada alteração aceita cria uma revisão imutável, mantém intacta a fonte capturada,
detecta edições concorrentes e pode ser inspecionada, restaurada ou redefinida pela interface web.
Busca, resumos, recuperação pelo chat e compilação fundamentada do grafo usam a correção ativa sem
perder a proveniência da fonte.

A assistente integrada pode propor uma prévia limitada da correção, sempre sujeita à aprovação
explícita. Clientes MCP com escopo de escrita recebem as mesmas operações conscientes de revisão;
tokens somente de leitura podem pesquisar e inspecionar o histórico sem obter permissão de mutação.
