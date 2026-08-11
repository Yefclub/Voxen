# Spec 193 — Comunidades Leiden no grafo de conhecimento

## Contexto

A Voxen apresenta “comunidades” como componentes conexos: qualquer ponte entre
dois grupos faz todos os seus nós parecerem uma única comunidade. Isso oculta
os temas reais da base, produz rótulos pouco representativos e limita o uso do
grafo pelo futuro Guia pessoal.

Esta entrega substitui essa heurística por uma partição Leiden ponderada e
explicável sobre cada recorte já autorizado do grafo. Ela preserva os limites
atuais de leitura e não cria fatos, arestas ou comunidades persistentes.

## Glossário

- **Comunidade**: grupo não sobreposto de nós estruturalmente mais relacionados
  entre si do que com o restante do recorte.
- **Peso efetivo**: força positiva de uma ligação, derivada da confiança, do
  tipo da relação e da qualidade de sua evidência.
- **Coesão**: proporção do peso de uma comunidade que permanece entre seus
  próprios membros.
- **Partição**: atribuição de cada nó elegível a no máximo uma comunidade.

## Requisitos

### Ubiquitous

- The system shall calcular comunidades somente sobre nós e arestas já autorizados no recorte do usuário autenticado.
- The system shall usar pesos positivos que preservem confiança, evidência e semântica da relação sem transformar inferência fraca em ligação forte.
- The system shall agregar ligações paralelas do mesmo par antes de executar a detecção, sem contar duas vezes a direção de uma relação.
- The system shall produzir a mesma partição e a mesma ordenação para o mesmo grafo, configuração e versão do algoritmo.
- The system shall manter cada comunidade retornada internamente conectada por ligações elegíveis.
- The system shall expor nome, versão, objetivo, resolução e semente do algoritmo junto da partição.
- The system shall expor tamanho, nó representativo, peso interno, peso de fronteira e coesão de cada comunidade retornada.
- The system shall usar a partição calculada pelo servidor no layout e nos insights do cliente, sem recalcular componentes conexos incompatíveis.

### Event-driven

- When um recorte do grafo for gerado, the system shall detectar suas comunidades depois dos limites defensivos e antes de montar os insights da resposta.
- When filtros locais reduzirem os nós visíveis, the system shall preservar as atribuições Leiden dos membros restantes e recalcular apenas os metadados visuais necessários.
- When duas comunidades tiverem o mesmo tamanho, the system shall ordená-las por coesão, peso interno, rótulo e identificadores estáveis.
- When uma comunidade for rotulada, the system shall escolher seu membro mais representativo pelo peso interno ponderado, com desempate determinístico.

### State-driven

- While o grafo tiver nós isolados, the system shall mantê-los visíveis sem promovê-los a comunidades temáticas relevantes.
- While o grafo estiver sendo reindexado, the system shall calcular insights apenas sobre o snapshot consistente que já foi lido.

### Optional

- Where uma resposta antiga não contiver metadados Leiden, the client shall usar uma separação conectada determinística apenas como compatibilidade retroativa.

### Unwanted behavior

- If o recorte não possuir nós ou ligações elegíveis, then the system shall retornar uma partição vazia válida sem lançar erro.
- If uma confiança, peso ou metadado de evidência for inválido, then the system shall limitar ou substituir o valor por um padrão seguro e finito.
- If uma ligação apontar para nó ausente do recorte, then the system shall ignorá-la sem criar membro ou expor identificador adicional.
- If a detecção Leiden falhar, then the system shall retornar comunidades conectadas determinísticas, identificar o fallback e manter a rota do grafo disponível.

## Critérios de Aceite

- [x] Dois grupos densos unidos por uma ponte são separados em comunidades distintas.
- [x] Cada comunidade Leiden retornada é conectada e cada nó aparece no máximo uma vez.
- [x] Pesos de confiança, evidência e tipo de relação alteram a influência das ligações de forma testável.
- [x] Ligações paralelas e recíprocas são agregadas por par de nós.
- [x] A mesma entrada produz IDs, ordem, rótulos e métricas idênticos em execuções repetidas.
- [x] A API inclui configuração do algoritmo, qualidade da partição e métricas explicáveis por comunidade.
- [x] O layout 2D/3D e os cartões de insights consomem a mesma partição retornada pelo servidor.
- [x] Nós isolados continuam visíveis e não poluem a lista de comunidades relevantes.
- [x] Entradas vazias, inválidas e uma falha controlada do detector usam fallback sem derrubar a rota.
- [x] Testes provam isolamento de recorte, conectividade, determinismo, ponderação e compatibilidade retroativa.

## Fora de Escopo

- Persistir comunidades como fatos ou nós canônicos do Brain.
- Gerar resumos de comunidade com IA.
- Calcular centralidade ponderada ou PageRank personalizado.
- Alterar extração semântica, resolução de entidades ou indexação do conteúdo.
- Personalizar comunidades com preferências ou intenção da sessão.

## Riscos / Decisões pendentes

- Leiden será aplicado ao recorte defensivo retornado pela API, não a um grafo
  ilimitado; por isso, a resposta identifica o algoritmo sem afirmar que a
  partição representa nós que ficaram fora do snapshot.
- Relações contraditórias continuam sendo ligações temáticas, mas recebem
  influência menor do que hierarquia, equivalência e evidência extraída.
- Comunidades de um único nó permanecem na partição interna para integridade,
  porém não aparecem como grupos temáticos nos insights.

> 2026-08-11: escopo aprovado como a quarta entrega da evolução do Guia pessoal.
