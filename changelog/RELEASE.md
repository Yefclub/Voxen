---
tipo: feat
titulo_en: Voxen 0.15.0 — a more capable personal knowledge workspace
titulo_pt_br: Voxen 0.15.0 — um espaço de conhecimento pessoal mais capaz
---

## A knowledge graph that helps explain personal context

The Brain now keeps temporal facts, safer entity aliases, durable graph
compilation, community detection, personalized ranking, and interest signals.
The Guide can turn those signals into explainable personal recommendations, and
chat and MCP can use the current user's graph context without crossing
workspace boundaries. An optional Mem0 shadow evaluation is available for
measurement only and is disabled by default.

## More control over captured knowledge

Voxen can ingest batches of URLs, save private media before ingestion, and
delete knowledge safely in the background. Notes and transcripts support
versioned, surgical edits while retaining original evidence and exact passage
anchors. Mermaid flows are reviewable and interactive, and research enrichment
can follow bounded gaps back to the original cited source.

## Clearer retrieval and chat evidence

Chat search now combines complementary knowledge-base queries and shows the
queries, sources, and semantic-retrieval contribution behind a result. Chat
references can open inside Voxen, including external web and X citations, while
reasoning collapses when the answer begins so the response stays readable.
MCP clients can connect through OAuth 2.1, with clearer setup guidance and
theme-aware configuration.

## More resilient self-hosted operations

Ingestion recovery now distinguishes provider failures, retries temporary
contention, avoids duplicate source processing, and surfaces actionable YouTube,
TikTok, and OpenRouter diagnostics. Structured logs and safer operational
filters make copied Docker or Easypanel logs easier to investigate without
exposing provider payloads or credentials. New self-hosted installations use a
local storage volume by default, while existing deployments retain their
configured storage.

## Operational notes

This release includes database migrations. Back up the instance before
upgrading and let the normal deployment migration step complete before serving
traffic. The new graph, enrichment, and shadow-evaluation capabilities remain
bounded by the current user's workspace; Mem0 remains opt-in and requires a
separately hosted service.

<!-- pt-BR -->

## Um grafo de conhecimento que explica melhor o contexto pessoal

O Brain agora mantém fatos temporais, aliases de entidades mais seguros,
compilação durável do grafo, detecção de comunidades, ranking personalizado e
sinais de interesse. O Guia transforma esses sinais em recomendações pessoais
explicáveis, e o chat e o MCP podem usar o contexto do grafo do usuário atual
sem atravessar limites de workspace. Uma avaliação opcional do Mem0 em shadow
mode existe apenas para medição e fica desativada por padrão.

## Mais controle sobre o conhecimento capturado

A Voxen pode ingerir lotes de URLs, salvar mídia privada antes da ingestão e
excluir conhecimento com segurança em segundo plano. Notas e transcrições
suportam edições cirúrgicas versionadas, preservando a evidência original e
âncoras de trechos exatos. Fluxos Mermaid podem ser revisados e explorados de
forma interativa, e o enriquecimento de pesquisa pode seguir lacunas limitadas
até a fonte original citada.

## Recuperação e evidências do chat mais claras

A busca do chat agora combina consultas complementares na Base de conhecimento
e mostra as consultas, fontes e contribuição da recuperação semântica por trás
de um resultado. Referências do chat podem abrir dentro da Voxen, incluindo
citações externas da web e do X, enquanto o raciocínio recolhe quando a
resposta começa para manter o texto legível. Clientes MCP podem conectar por
OAuth 2.1, com orientação de configuração mais clara e configuração sensível
ao tema.

## Operações self-hosted mais resilientes

A recuperação de ingestão agora diferencia falhas de provedores, repete
contenções temporárias, evita processamento duplicado da mesma fonte e mostra
diagnósticos acionáveis de YouTube, TikTok e OpenRouter. Logs estruturados e
filtros operacionais mais seguros facilitam investigar logs copiados do Docker ou
Easypanel sem expor payloads de provedores ou credenciais. Novas instalações
self-hosted usam um volume local por padrão, enquanto implantações existentes
mantêm o armazenamento configurado.

## Notas operacionais

Esta release inclui migrations de banco. Faça backup da instância antes de
atualizar e deixe a etapa normal de migration do deploy terminar antes de
atender tráfego. Os recursos novos de grafo, enriquecimento e avaliação em
shadow continuam limitados ao workspace do usuário atual; o Mem0 segue opt-in e
exige um serviço hospedado separadamente.
