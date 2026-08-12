---
tipo: feat
titulo_en: Optional conversational-memory shadow evaluation
titulo_pt_br: Avaliação opcional de memória conversacional em shadow mode
---

Voxen can now evaluate a separately hosted Mem0 OSS service without changing
answers or canonical knowledge. The adapter is disabled by default, isolates
users through opaque server-derived subjects, records provenance only after a
completed chat turn, and removes remote memories before account deletion. A
privacy-safe live harness measures retrieval quality, isolation, deletion,
latency, token volume, and reported cost before any future controlled use.

<!-- pt-BR -->

A Voxen agora pode avaliar um serviço Mem0 OSS hospedado separadamente sem
alterar respostas nem o conhecimento canônico. O adaptador é desativado por
padrão, isola usuários por sujeitos opacos derivados no servidor, registra
proveniência apenas após concluir um turno do chat e remove memórias remotas
antes da exclusão da conta. Um avaliador ao vivo sem conteúdo sensível mede
qualidade, isolamento, exclusão, latência, tokens e custo informado antes de
qualquer uso controlado futuro.
