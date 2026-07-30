# Spec 117 — Acabamento e consistência das superfícies

## Contexto

A fundação visual Linear e as primeiras revisões de mobile, jobs, Grafo e
Novidades já existem, mas a adoção dos primitives de página ficou incompleta.
Rotas equivalentes continuam usando larguras e espaçamentos próprios, o que
desperdiça área útil e faz a interface mudar de tamanho durante a navegação.

O modal de nova versão também mistura releases, perde mudanças promovidas e
não mantém uma área de rolagem funcional. As ações de adiar, abrir o histórico
e aplicar a atualização ainda compartilham um estado permanente incompatível
com o texto apresentado ao usuário.

Em 2026-07-29, uma validação após deploy mostrou que o problema podia sobreviver
mesmo com o componente corrigido no servidor: o service worker continuava
servindo o `index.html` precacheado e, portanto, o JavaScript antigo do modal.
Esse bundle antigo ainda buscava as quatro releases mais recentes, criava
rolagens aninhadas e deixava o rodapé fora da viewport. Ao mesmo tempo, o
backend transformava uma versão de pacote já marcada como dev em outra versão
sintética, sem entrada correspondente no changelog.

## Glossário

- **Build carregado**: identidade e versão do bundle que está executando na aba.
- **Build disponível**: identidade e versão informadas pelo servidor.
- **Adiar**: ocultar temporariamente o aviso sem marcar o build como aplicado.
- **Release alvo**: entrada do changelog cuja versão e canal correspondem ao
  build disponível.
- **Shell de página**: primitive que define largura, gutters, ritmo vertical e
  entrada visual de uma rota.
- **Leitura**: superfície textual com largura controlada.
- **Workspace**: superfície de edição ou operação que usa a maior parte da tela.
- **Dados amplos**: superfície de tabelas, filtros ou painéis que pode chegar a
  1600 pixels CSS.
- **Full-bleed**: superfície que controla a área útil inteira, como Chat e Grafo.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall apresentar no modal somente a release alvo.
- The system shall preservar título, resumo, corpo e mudanças promovidas da
  release alvo.
- The system shall manter cabeçalho e ações do modal visíveis enquanto o
  conteúdo central rola verticalmente.
- The system shall manter a versão amigável do build carregado separada da
  identidade técnica usada para detectar atualizações.
- The system shall tratar aplicar, adiar e abrir o histórico como intenções
  distintas.
- The system shall usar shells canônicos de leitura, workspace, dados amplos ou
  full-bleed em todas as rotas.
- The system shall usar os mesmos gutters e ritmo vertical para páginas da mesma
  categoria.
- The system shall manter Chat, Grafo, autenticação e onboarding em shells
  dedicados compatíveis com sua função.
- The system shall usar uma única animação coordenada de entrada por página e
  respeitar movimento reduzido.
- The system shall manter componentes shadcn/Radix como base de diálogos,
  botões, formulários e superfícies de dados.
- The system shall manter a pesquisa web como ferramenta OpenRouter, sem
  apresentá-la como provedor ou modelo separado no onboarding.
- The system shall registrar tempos das etapas anteriores ao primeiro evento do
  modelo para permitir distinguir latência interna de latência do provedor.
- The system shall tratar uma versão prerelease presente no `package.json` como
  identidade canônica, sem gerar outra versão dev durante source deploy ou
  empacotamento da imagem Easypanel.
- The system shall buscar navegações HTML online antes de recorrer ao cache e
  não deverá servir `index.html` diretamente do precache.
- The system shall manter uma única região rolável no modal, delimitada por
  linhas explícitas de cabeçalho, conteúdo e ações.

### Event-driven (resposta a evento)

- When o servidor informar um build diferente do carregado, the system shall
  abrir o modal com a versão anterior, a nova versão e a release alvo.
- When o servidor informar um build diferente do carregado, the system shall
  também solicitar em segundo plano a atualização do service worker, sem
  atrasar a abertura do modal nem recarregar a página automaticamente.
- When o usuário rolar o conteúdo do modal, the system shall permitir movimento
  vertical por mouse, trackpad, toque e teclado sem mover o documento ao fundo.
- When o usuário escolher adiar, the system shall ocultar o modal por 30 minutos
  e reapresentá-lo depois desse período se a aba ainda estiver desatualizada.
- When o usuário abrir o histórico completo, the system shall navegar para
  Novidades e adiar o aviso sem marcar o build como aplicado.
- When o usuário aplicar a atualização, the system shall solicitar a atualização
  do service worker e recarregar a página sem suprimir um aviso futuro se o
  bundle antigo continuar carregado.
- When uma rota de conteúdo comum for aberta, the system shall usar o shell
  canônico atribuído àquela rota.
- When uma resposta de chat começar, the system shall emitir um estado
  operacional antes de buscar configuração, compactação ou contexto.
- When a resposta alcançar o primeiro evento do modelo, the system shall
  registrar a duração de preparação e o tempo até esse evento sem expor prompts
  ou raciocínio interno.

### State-driven (durante um estado)

- While o modal estiver carregando a release alvo, the system shall manter sua
  estrutura e ações estáveis e mostrar um estado de carregamento.
- While a release possuir conteúdo maior que a altura disponível, the system
  shall limitar o modal a 92 por cento da viewport dinâmica e rolar apenas a
  região central.
- While a aplicação estiver online, the system shall obter o documento HTML da
  rede e atualizar o fallback de navegação; o cache só poderá responder quando
  a rede estiver indisponível.
- While uma resposta estiver em streaming, the system shall impedir a aplicação
  da atualização e explicar o motivo sem impedir adiar ou abrir Novidades.
- While uma página estiver em viewport desktop ampla, the system shall usar o
  espaço previsto para sua categoria sem `max-width` arbitrário local.
- While uma página estiver em viewport estreita, the system shall usar gutters
  mobile canônicos e não criar overflow horizontal.

### Optional (feature opcional)

- Where a release possuir link de PR, the system shall permitir abrir a origem
  em nova aba com isolamento de navegação.
- Where o usuário preferir movimento reduzido, the system shall apresentar o
  modal e as páginas sem deslocamentos decorativos.
- Where o runtime do worker estiver disponível, the system shall expor em logs
  de inicialização as versões do yt-dlp e do backend de impersonação.

### Unwanted behavior (condições de erro)

- If a release exata não existir, then the system shall explicar que as notas
  ainda não estão disponíveis, manter as ações e oferecer nova tentativa.
- If a consulta da release falhar, then the system shall distinguir falha de
  lista vazia e oferecer nova tentativa.
- If o usuário fechar o modal por Escape, backdrop ou botão de fechar, then the
  system shall aplicar o mesmo adiamento temporário da ação “Agora não”.
- If o build disponível continuar diferente depois de uma tentativa de
  atualização, then the system shall voltar a avisar após o adiamento e não
  tratá-lo como aplicado.
- If o package version já contiver um sufixo prerelease, then the system shall
  preservá-lo literalmente no endpoint de versão.
- If uma rota de conteúdo comum introduzir largura ou padding externo próprio,
  then the system shall falhar no teste de consistência de shells.
- If uma animação de página falhar, then the system shall limpar estilos
  transitórios e manter todo o conteúdo utilizável.
- If uma plataforma de mídia bloquear extração automatizada, then the system
  shall classificar o erro e orientar proxy, cookies ou upload manual sem
  prometer contornar a proteção externa.

## Critérios de Aceite

- [x] O endpoint de releases aceita versão exata combinada com canal.
- [x] O modal busca uma única release correspondente ao build disponível.
- [x] Mudanças promovidas aparecem dentro do modal.
- [x] Cabeçalho e rodapé permanecem fixos e a região central possui rolagem
      vertical funcional com conteúdo longo.
- [x] Carregamento, vazio e erro são estados visualmente distintos.
- [x] “Agora não”, Escape, backdrop e fechar adiam por 30 minutos.
- [x] Abrir Novidades não marca o build como aplicado.
- [x] Uma tentativa de atualização que continue no bundle antigo não silencia
      futuras notificações.
- [x] O HTML informa separadamente identidade e versão do build carregado.
- [x] Todas as rotas de conteúdo usam um shell canônico sem wrappers locais de
      largura e gutters.
- [x] Chat e Grafo continuam full-bleed e fluxos de autenticação permanecem
      dedicados.
- [x] Páginas da mesma categoria compartilham largura, padding e ritmo vertical.
- [x] Nenhuma página combina animação de shell com uma segunda animação de
      entrada equivalente.
- [x] O chat emite estado imediato e registra tempos de preparação e primeiro
      evento do modelo.
- [x] A política de pesquisa web permanece uma ferramenta OpenRouter e não
      reaparece no onboarding.
- [x] Diagnóstico de yt-dlp continua registrando versões e erros de plataforma
      sem vazar proxy, cookies ou segredos.
- [x] Testes cobrem versão/canal da release, adiamento, falha, promoted, contrato
      de rolagem e inventário de shells.
- [x] Lint, formatação, typecheck, testes e build passam sem Docker nem
      Playwright local.
- [x] O build gerado não inclui `index.html` no precache e registra navegação
      `NetworkFirst` com preload.
- [x] O modal usa exatamente três linhas de layout
      (`auto minmax(0,1fr) auto`), sem um segundo contêiner rolável.
- [x] Uma versão `X.Y.Z-dev.<timestamp>` do pacote permanece idêntica no
      `/api/version`, permitindo localizar sua release exata.
- [x] A detecção de mismatch inicia uma única atualização best-effort do
      service worker por build, mantendo o modal imediatamente disponível.

## Fora de Escopo

- Adicionar provedores além da OpenRouter.
- Transcrição local.
- Substituir o yt-dlp ou garantir extração contra bloqueios de terceiros.
- Alterar a identidade visual, o logotipo ou o nome Voxen.
- Executar Docker ou Playwright localmente.

## Riscos / Decisões pendentes

- A classificação de shells é funcional: leitura limita texto; workspace usa
  `max-w-7xl`; dados amplos usa até 1600 pixels; Chat e Grafo são full-bleed.
- O adiamento de 30 minutos evita repetição agressiva sem esconder
  permanentemente uma atualização.
- A release alvo deve coincidir por versão e canal; mostrar uma release antiga
  como fallback seria mais enganoso do que mostrar o estado indisponível.

> 2026-07-29: criada após auditoria do modal e das larguras divergentes por
> solicitação explícita de concluir todas as melhorias e correções.
>
> 2026-07-29: reaberta após evidência visual de que o app shell precacheado
> mantinha o modal antigo ativo mesmo depois do deploy da correção.

## Evidências de implementação

- Web: 656 testes passaram, 134 integrações sem PostgreSQL foram puladas; lint,
  typecheck e build Vite de produção passaram.
- Worker: 245 testes passaram e 3 integrações sem PostgreSQL foram puladas;
  Ruff e mypy passaram.
- O contrato visual foi validado por primitives compartilhados, testes de
  estrutura e build. Docker e Playwright não foram executados por restrição
  explícita desta entrega; a CI Linux valida os cenários com infraestrutura.
- No PowerShell, o script agregado `build` usa uma condição POSIX anterior ao
  Vite; por isso o build local foi executado diretamente com o mesmo `vite
build`. A CI Linux continua exercitando o script agregado e o empacotamento
  da extensão.
