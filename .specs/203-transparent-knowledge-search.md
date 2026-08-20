# Busca transparente e multiquery na Base de conhecimento

## Objetivo

Transformar a busca inicial da Base de conhecimento em uma recuperação multiquery limitada, com fusão determinística e telemetria de produto visível no turno do chat.

## Requisitos (EARS)

- Quando o agente consultar `search_knowledge`, o sistema deve aceitar de uma a três consultas semânticas curtas, mantendo a primeira como intenção principal.
- Quando houver mais de uma consulta, o sistema deve executá-las concorrentemente e fundir resultados por reciprocal-rank fusion, removendo fontes duplicadas.
- O sistema deve preservar o isolamento por `userId` de todas as consultas derivadas.
- Quando a busca concluir, a interface deve apresentar as consultas usadas, a estratégia de fusão, a quantidade de fontes retornadas por tipo e se o resgate semântico contribuiu.
- A interface não deve renderizar valores arbitrários da saída da ferramenta nem cadeia de raciocínio do modelo.
- Quando uma consulta for vazia, repetida ou exceder o limite, o sistema deve descartá-la e manter uma busca válida pela intenção principal.

## Critérios de aceite

- Até três consultas válidas são executadas em paralelo; duplicatas normalizadas não geram trabalho extra.
- A fonte repetida entre consultas aparece uma única vez e a ordenação favorece recorrência entre variantes.
- O resultado da ferramenta contém um plano de recuperação JSON-safe para a UI.
- A linha expandida de `search_knowledge` comunica plano, variantes, contagens e estado semântico em PT-BR e inglês.
- Testes cobrem normalização, fusão/deduplicação, metadados de transparência e a apresentação segura.
