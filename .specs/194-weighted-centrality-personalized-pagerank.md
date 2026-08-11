# Spec 194 — Centralidade ponderada e PageRank personalizado

## Contexto

A Voxen já separa preferências explícitas, interesse inferido e intenção de
sessão, além de detectar comunidades Leiden no recorte autorizado do grafo.
Ainda assim, os “hubs” da interface são ordenados apenas pelo número bruto de
ligações. Esse grau simples trata uma inferência ambígua como equivalente a
uma relação extraída e não distingue importância estrutural de relevância
pessoal.

Esta entrega calcula métricas determinísticas e explicáveis sobre o mesmo
recorte limitado do grafo: grau ponderado, PageRank estrutural e Personalized
PageRank alimentado somente por interesses duráveis positivos que apontem para
nós Brain presentes no recorte. Ela não altera fatos, comunidades ou o ranking
de respostas do Guia, chat e MCP.

## Glossário

- **Grau ponderado**: soma dos pesos efetivos das ligações incidentes em um nó.
- **PageRank estrutural**: importância global no recorte usando teletransporte
  uniforme.
- **Personalized PageRank (PPR)**: importância no recorte usando como vetor de
  teletransporte os interesses duráveis positivos do usuário.
- **Semente**: nó Brain referenciado por uma projeção de interesse positiva.
- **Lift pessoal**: diferença normalizada entre o PPR e o PageRank estrutural.
- **Fallback uniforme**: PPR equivalente ao PageRank estrutural quando nenhuma
  semente válida estiver presente no recorte.

## Requisitos

### Ubiquitous

- The system shall calcular centralidade somente sobre nós e arestas já autorizados no recorte do usuário autenticado.
- The system shall reutilizar os mesmos pesos efetivos finitos e as mesmas ligações agregadas usados pela detecção de comunidades.
- The system shall calcular grau ponderado normalizado, PageRank estrutural e Personalized PageRank para cada nó visível.
- The system shall manter importância estrutural e relevância pessoal em campos separados.
- The system shall usar apenas itens duráveis com pontuação positiva e `brainNodeId` válido como sementes pessoais.
- The system shall preservar projeções negativas como evidência contabilizada, sem convertê-las em teletransporte positivo.
- The system shall expor versão do algoritmo, damping factor, tolerância, limite de iterações, convergência, quantidade de sementes e watermark das projeções.
- The system shall produzir a mesma pontuação e ordenação para o mesmo grafo, projeções, configuração e versão do algoritmo.

### Event-driven

- When um recorte do grafo for gerado, the system shall obter as projeções duráveis atualizadas antes de montar o ranking personalizado.
- When uma mesma semente aparecer em mais de um horizonte, the system shall combinar seus pesos por horizonte sem duplicar o nó no vetor de teletransporte.
- When o PageRank convergir antes do limite, the system shall interromper as iterações e informar a quantidade executada.
- When dois nós tiverem a mesma pontuação, the system shall desempatar por grau ponderado, rótulo e identificador estável.
- When a projeção de interesse mudar, the system shall usar um cache distinto identificado pelo watermark e versão da projeção.

### State-driven

- While o recorte possuir nós isolados, the system shall mantê-los com massa de teletransporte válida e pontuações finitas.
- While houver sementes positivas fora do recorte, the system shall ignorá-las sem expor identificadores ou alterar o universo autorizado.
- While o recorte estiver truncado, the system shall identificar que as métricas representam apenas o snapshot retornado.

### Optional

- Where a resposta antiga não contiver métricas ponderadas, the client shall continuar aceitando o campo de grau simples para compatibilidade.

### Unwanted behavior

- If não houver sementes positivas válidas no recorte, then the system shall usar teletransporte uniforme e identificar o fallback sem falhar a rota.
- If uma confiança, evidência, relação ou pontuação de projeção for inválida, then the system shall limitar ou substituir o valor por um padrão seguro e finito.
- If uma ligação apontar para nó ausente ou para o próprio nó, then the system shall ignorá-la sem criar massa ou identificador adicional.
- If o cálculo não convergir até o limite, then the system shall retornar a última distribuição finita normalizada e informar `converged: false`.
- If o recorte estiver vazio, then the system shall retornar ranking e metadados vazios válidos.

## Critérios de Aceite

- [ ] O grau ponderado diferencia relações fortes de relações ambíguas ou fracas.
- [ ] PageRank estrutural e PPR retornam distribuições finitas normalizadas para grafos conectados, desconectados e com isolados.
- [ ] Uma semente pessoal eleva deterministicamente o próprio nó e sua vizinhança no PPR sem sobrescrever o PageRank estrutural.
- [ ] Projeções negativas e itens sem `brainNodeId` não se tornam sementes positivas.
- [ ] Sementes ausentes do recorte ativam fallback uniforme explicitamente identificado.
- [ ] A API expõe métricas por nó e metadados explicáveis do algoritmo e da personalização.
- [ ] Os hubs do cliente usam centralidade ponderada e continuam compatíveis com respostas antigas.
- [ ] O cache do grafo varia com watermark e versão da projeção pessoal.
- [ ] Entradas vazias ou inválidas não produzem `NaN`, `Infinity`, `null` acidental ou falha da rota.
- [ ] Testes provam determinismo, ponderação, personalização, fallback e isolamento do recorte.

## Fora de Escopo

- Alterar o ranking final do Guia, chat, MCP ou busca.
- Misturar intenção efêmera de sessão nas projeções duráveis.
- Persistir pontuações de centralidade como fatos do Brain.
- Gerar descrições de hubs ou comunidades com IA.
- Criar conhecimento temporal ou resolver entidades duplicadas.

## Riscos / Decisões pendentes

- As pontuações descrevem apenas o recorte defensivo de até 500 nós e 1.500
  arestas; elas não afirmam centralidade sobre conteúdo que ficou fora dele.
- Horizontes curto, médio e longo recebem pesos decrescentes e documentados. A
  personalização usa somente o `score` final positivo já separado pela spec
  192, sem reclassificar eventos brutos nesta camada.
- A intenção de sessão permanece separada nesta entrega para impedir que um
  desvio temporário altere a leitura durável do grafo.

> 2026-08-11: escopo aprovado como a quinta entrega da evolução do Guia pessoal.
