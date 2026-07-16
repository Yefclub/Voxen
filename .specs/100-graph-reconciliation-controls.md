# Spec 100 — Reconciliação e navegação do Brain 3D

## Status

Aprovado pelo owner em 2026-07-15.

## Contexto

O Brain pode entrar em reconciliações repetidas porque os dois indexadores que
materializam conteúdos usam marcadores de compatibilidade diferentes e um deles
substitui o marcador gravado pelo outro. O resultado aparece como ciclos de
indexação, estado “Organizando” prolongado e falha terminal de cobertura mesmo
quando os conteúdos já possuem nós materializados.

Na visualização 3D, todas as comunidades são distribuídas como satélites. A maior
comunidade, que representa o núcleo do conhecimento, também nasce fora da origem;
o enquadramento global considera os pequenos componentes isolados e mantém o
nócleo cortado na borda superior. Os controles atuais também não expõem as ações
básicas de navegação da câmera.

## Glossário

- **Índice completo**: materialização de uma fonte com conceitos e relações
  derivados pela versão corrente do Brain.
- **Índice compatível**: materialização mínima produzida durante a ingestão, que
  ainda pode exigir o passe completo.
- **Comunidade principal**: maior componente conectado do snapshot visível.
- **Satélite**: componente conectado menor posicionado ao redor da comunidade
  principal.

## Requisitos

### Ubiquitous

- The system shall preservar marcadores de indexação já conhecidos quando outro
  indexador atualizar a mesma fonte.
- The system shall distinguir uma materialização compatível de uma materialização
  completa sem declarar como completo um passe parcial.
- The system shall manter a comunidade principal do grafo 3D centrada na origem.
- The system shall fornecer controles acessíveis para aproximar, afastar,
  reenquadrar a comunidade principal e mostrar todo o grafo.
- The system shall preservar a proveniência das relações entre conteúdos,
  conceitos, pastas e fontes.
- The system shall serializar os indexadores web e worker pelo mesmo lease Redis
  por usuário, sem mutação local quando a coordenação estiver indisponível.

### Event-driven

- When o índice completo materializar uma fonte, the system shall registrar
  também a compatibilidade já atendida pelo mesmo passe.
- When o índice compatível atualizar uma fonte já materializada pelo índice
  completo, the system shall preservar o marcador completo existente.
- When uma fonte mudar enquanto outro indexador possuir o lease, the system shall
  detectar a divergência pelo `updatedAt` e reconciliá-la em um passe posterior.
- When uma fonte for removida sem conseguir limpar o Brain imediatamente, the
  system shall remover seu nó órfão no próximo passe completo.
- When um snapshot 3D for carregado ou sua topologia mudar, the system shall
  enquadrar a comunidade principal depois que a cena estiver pronta.
- When o usuário acionar “Mostrar tudo”, the system shall enquadrar todos os nós
  visíveis sem alterar suas relações ou filtros.
- When o usuário selecionar um hub ou uma comunidade, the system shall centralizar
  a câmera no alvo e manter disponíveis os controles de retorno.

### State-driven

- While uma reconciliação real estiver em andamento, the system shall manter o
  snapshot materializado interativo e atualizar somente o estado da indexação.
- While não houver trabalho de reconciliação pendente, the system shall manter o
  estado terminal pronto sem iniciar novos passes por divergência de marcadores.
- While existirem comunidades satélite, the system shall distribuí-las ao redor
  do núcleo sem deslocar a comunidade principal da origem.
- While o grafo estiver em modo 3D, the system shall identificar textualmente a
  função de cada controle de câmera.

### Optional

- Where o grafo possuir apenas uma comunidade, the system shall posicioná-la na
  origem sem criar uma órbita vazia.
- Where não houver comunidade com nós, the system shall manter os controles de
  câmera inativos sem gerar erro.

### Unwanted behavior

- If um passe compatível não executar todas as etapas do índice completo, then
  the system shall não marcar a fonte como completamente atualizada.
- If dois indexadores atualizarem a mesma fonte em sequência, then the system
  shall convergir para um estado estável em vez de alternar marcadores.
- If o reenquadramento inicial ocorrer antes de a cena estar pronta, then the
  system shall tentar novamente por um número limitado de ciclos de renderização
  sem criar polling permanente.
- If uma fonte falhar durante a reconciliação, then the system shall encerrar o
  passe com diagnóstico observável e tentativa explícita, sem loop imediato.
- If Redis estiver indisponível antes da aquisição do lease, then the system
  shall preservar o snapshot, retornar erro recuperável com cooldown e não
  iniciar materialização local.
- If o ownership do lease for perdido dentro de um item, then the system shall
  interromper antes do marcador final e manter a fonte pendente.

## Critérios de Aceite

- [x] Testes comprovam que o passe completo registra os dois marcadores de
      compatibilidade esperados.
- [x] Testes comprovam que uma falha antes da finalização remove os marcadores
      de conclusão e que nós auxiliares não recebem um falso estado completo.
- [x] Testes comprovam que FK/evidência ausente e perda do lease dentro do item
      propagam falha e deixam os marcadores de conclusão ausentes.
- [x] Web e worker usam a mesma chave, TTL e ownership; ocupado ou Redis
      indisponível não permite duas materializações simultâneas.
- [x] Passes longos renovam o lease por heartbeat e os guards locais não fazem
      round-trip ao Redis em cada mutação curta.
- [x] Cobertura detecta fontes atualizadas e nós órfãos, inclusive quando a
      biblioteca ficou vazia, e o passe completo converge esses casos.
- [x] Testes comprovam que o passe compatível preserva o marcador completo e não
      se apresenta como índice completo quando ele ainda não existe.
- [x] Após um passe completo, os critérios de cobertura convergem e não agendam
      nova reconciliação apenas por divergência entre indexadores.
- [x] O hub que ancora a comunidade principal ocupa a origem em snapshots com uma
      ou várias comunidades.
- [x] Comunidades menores ocupam órbitas previsíveis ao redor do núcleo sem
      sobreposição integral.
- [x] O enquadramento inicial usa os nós da comunidade principal e “Mostrar tudo”
      usa todos os nós visíveis.
- [x] O modo 3D expõe ações acessíveis de aproximar, afastar, focar o núcleo e
      mostrar tudo, usando os controles nativos da câmera.
- [x] Seleção, duplo clique, filtros, fallback 2D e tema continuam funcionais.
- [x] Testes focados web e worker, lint, typecheck e build web passam sem Docker
      nem Playwright local.

## Fora de Escopo

- Trocar a biblioteca de renderização 3D.
- Alterar o schema do banco ou criar novos tipos de nó e relação.
- Implementar paginação acima do limite defensivo do snapshot.
- Atualizar o Prisma para uma nova versão principal.
- Executar Docker ou Playwright localmente.

## Riscos / Decisões pendentes

- O snapshot continua limitado aos nós mais recentes; paginação e agregação de
  grafos maiores exigem uma spec própria.
- O aviso de depreciação do relógio 3D é emitido internamente pelo renderer e não
  bloqueia esta correção; uma atualização de dependência deve ser tratada
  separadamente com verificação de compatibilidade.
