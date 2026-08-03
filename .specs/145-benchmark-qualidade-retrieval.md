# Spec 145 — Benchmark determinístico de recuperação e citações

## Requisitos

- O sistema DEVE versionar um corpus sintético em PT-BR com pergunta, fontes,
  trecho/timestamp esperado e casos de sinônimo, informalidade, conteúdo longo,
  múltiplas fontes, conflito e ausência de evidência.
- O benchmark DEVE calcular recall de fonte, precisão e cobertura de citação,
  latência, custo e taxa de resposta sem suporte sem chamar modelos externos.
- Quando uma estratégia nova for avaliada, o benchmark DEVE compará-la ao baseline
  FTS e falhar se houver regressão de recuperação ou de citações.
- O corpus NÃO DEVE conter dados reais nem segredos.

## Critérios de aceite

- A suíte roda deterministicamente no CI.
- Relatórios comparam FTS, híbrido e Brain quando aplicável.
- O gate impede regressão configurada de retrieval ou citação.
