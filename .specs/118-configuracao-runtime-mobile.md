# Spec 118 — Configuração e estabilidade do runtime mobile

## Status

Em validação no CI. A implementação e as suítes locais foram concluídas em
2026-07-30; os testes com PostgreSQL/Redis ficam a cargo do CI porque esta
entrega não inicia Docker nem Playwright.

## Contexto

A configuração da OpenRouter ainda aparece em superfícies e capacidades
separadas, embora o produto opere com um único provedor e possua padrões
canônicos. O fluxo deve pedir somente a chave, validar sua capacidade e aplicar
automaticamente uma configuração completa. A ingestão deve manter uma rota
determinística por tipo de conteúdo, sem dependências de transcrição local.

Também há instabilidades perceptíveis no runtime web: caches PWA podem conservar
um bundle diferente da versão disponível, notificações simultâneas se sobrepõem,
e a atualização periódica da Fila pode reiniciar estados visuais sem que os
dados tenham mudado. No mobile, o gesto da sidebar pode competir com tabelas e
controles horizontais e deixar uma sombra visível depois do fechamento.

Esta spec consolida esses comportamentos sem adicionar provedores, modelos
configuráveis ou novos formatos de ingestão.

## Glossário

- **Configuração unificada**: única superfície administrativa que recebe a
  chave da OpenRouter e aplica os padrões necessários sem seleção manual de
  modelos.
- **Versão do build**: identidade canônica da aplicação usada pela interface,
  pelo service worker e pelos caches PWA.
- **Atualização silenciosa da Fila**: reconciliação de dados que preserva
  identidade visual, foco, rolagem e estado local dos itens.
- **Controle horizontal**: tabela, grade, carrossel, editor ou região rolável
  cujo gesto horizontal pertence ao próprio conteúdo.
- **Toast ativo**: única notificação transitória visível; as demais aguardam em
  uma fila FIFO.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall apresentar uma única configuração da OpenRouter que solicite
  somente a chave de API.
- The system shall aplicar automaticamente os modelos e parâmetros canônicos
  necessários depois de validar a chave.
- The system shall manter a chave da OpenRouter cifrada em repouso, ausente das
  respostas da API e redigida de logs e diagnósticos.
- The system shall processar PDFs pelo parser Mistral disponibilizado através da
  OpenRouter.
- The system shall processar documentos suportados que não sejam PDF por
  conversão MarkItDown antes da análise remota.
- The system shall processar imagens pela OpenRouter.
- The system shall manter transcrição de áudio e vídeo exclusivamente remota,
  sem modelo, binário ou fallback local de transcrição.
- The system shall gerar tags para todo conteúdo novo elegível sem transformar
  falha de enriquecimento em falha da ingestão concluída.
- The system shall escopar configuração, jobs, conteúdo, tags e eventos ao
  usuário autenticado.
- The system shall usar a versão canônica do build na identidade dos caches PWA
  e na decisão de atualização do service worker.
- The system shall exibir no máximo um toast por vez, por cinco segundos, e
  manter os demais em ordem FIFO.
- The system shall atualizar os dados da Fila sem reiniciar visualmente a
  página, a lista ou itens cujo estado semântico não mudou.
- The system shall manter a sidebar mobile sem sombra ou camada visual residual
  quando estiver totalmente fechada.
- The system shall registrar eventos operacionais com tipo de conteúdo, etapa,
  duração, resultado e identificadores seguros, sem registrar chave, payload
  integral, conteúdo extraído, nomes de arquivo, pasta ou tag, nem credenciais.

### Event-driven (resposta a evento)

- When o administrador salvar uma chave da OpenRouter, the system shall validar
  a chave e os recursos canônicos antes de persistir a configuração completa.
- When uma chave válida substituir a configuração existente, the system shall
  atualizar chave e padrões como uma única operação consistente.
- When um PDF for recebido, the system shall encaminhá-lo ao fluxo remoto de
  documento com parser Mistral e registrar o resultado da etapa.
- When um documento não-PDF suportado for recebido, the system shall extrair
  seu conteúdo com MarkItDown e encaminhar o resultado para análise remota.
- When uma imagem for recebida, the system shall encaminhá-la ao fluxo de visão
  da OpenRouter sem tentar tratá-la como documento ou áudio.
- When um conteúdo novo concluir sua persistência, the system shall agendar a
  geração idempotente de tags para esse conteúdo.
- When a versão canônica do build mudar, the system shall instalar os novos
  assets, ativar o cache correspondente e remover caches obsoletos depois que
  não forem mais necessários.
- When um toast encerrar seus cinco segundos ou for dispensado, the system shall
  removê-lo e apresentar o próximo item da fila, se existir.
- When a Fila receber snapshot, polling ou evento em tempo real, the system shall
  reconciliar somente os campos e itens efetivamente alterados.
- When uma resposta de polling da Fila for anterior ao último evento em tempo
  real aplicado, the system shall ignorar o progresso obsoleto e preservar o
  estado mais recente.
- When um gesto horizontal começar dentro de tabela, grade, região com rolagem
  horizontal ou controle interativo, the system shall reservar o gesto para o
  conteúdo e não iniciar a sidebar.
- When a sidebar terminar o fechamento, the system shall zerar progresso,
  transformação, backdrop e sombra na mesma conclusão visual.

### State-driven (durante um estado)

- While a configuração da OpenRouter estiver sendo validada, the system shall
  impedir submissões concorrentes e manter a configuração anterior utilizável.
- While uma ingestão estiver ativa, the system shall usar somente a rota
  correspondente ao tipo detectado e publicar etapas observáveis sem segredos.
- While a geração de tags estiver pendente, the system shall preservar o
  conteúdo como disponível e permitir reconciliação idempotente posterior.
- While a aba executar a mesma versão canônica do servidor, the system shall
  reutilizar apenas caches compatíveis com essa versão.
- While houver toasts aguardando, the system shall manter apenas o toast ativo
  em uma região acessível de anúncio.
- While a Fila estiver visível, the system shall preservar rolagem, foco,
  filtros, expansão de itens e identidade dos elementos durante atualizações de
  dados.
- While polling ou relógios operacionais da Fila estiverem ativos, the system
  shall evitar skeleton, animação de entrada, remount ou refresh visual global
  em intervalos periódicos.
- While um controle horizontal estiver manipulando ponteiro ou toque, the system
  shall não alterar o progresso da sidebar.

### Optional (feature opcional)

- Where um conteúdo já possuir tags válidas, the system shall ignorar nova
  geração automática sem custo remoto adicional.
- Where o usuário dispensar manualmente um toast, the system shall avançar
  imediatamente para o próximo sem reduzir seu tempo individual de cinco
  segundos.
- Where a aplicação estiver offline, the system shall servir somente assets
  compatíveis de uma versão previamente ativada e indicar indisponibilidade de
  operações remotas.
- Where o dispositivo informar movimento reduzido, the system shall atualizar
  sidebar, toasts e Fila sem deslocamentos decorativos.

### Unwanted behavior (condições de erro)

- If a chave da OpenRouter for inválida ou não oferecer um recurso canônico,
  then the system shall rejeitar a alteração sem persistir estado parcial.
- If a validação da OpenRouter não responder em até quinze segundos, then the
  system shall encerrar a tentativa com mensagem acionável e preservar a
  configuração anterior.
- If duas alterações da configuração ocorrerem concorrentemente, then the system
  shall serializá-las sem duplicar registros nem combinar chave e padrões de
  versões diferentes.
- If o parser remoto de PDF falhar, then the system shall classificar a falha,
  preservar diagnóstico seguro e não executar transcrição local.
- If o MarkItDown rejeitar um documento, then the system shall encerrar o job
  com erro acionável sem enviar bytes incompatíveis como imagem ou áudio.
- If a análise de imagem falhar, then the system shall preservar o erro do job
  sem registrar a imagem ou a chave em logs.
- If a geração de tags falhar, then the system shall manter a ingestão concluída
  e o enriquecimento elegível para retry limitado.
- If o service worker encontrar caches de versão diferente, then the system
  shall não misturar HTML, scripts ou estilos entre versões.
- If um service worker novo estiver aguardando ativação após a migração de um
  bundle antigo, then the system shall oferecer confirmação mesmo quando o
  bundle e o servidor já reportarem a mesma versão amigável.
- If múltiplos toasts chegarem simultaneamente, then the system shall enfileirar
  cada notificação uma única vez e não reiniciar o tempo do toast ativo.
- If uma atualização da Fila não alterar dados semânticos, then the system shall
  preservar as referências e não produzir mudança visual observável.
- If a conexão em tempo real da Fila cair, then the system shall reconciliar por
  polling sem limpar os dados existentes nem reiniciar a página.
- If um gesto começar em tabela, controle horizontal, elemento editável,
  elemento focável ou controle ARIA, then the system shall não abrir nem fechar
  a sidebar.
- If o gesto de fechamento for cancelado ou interrompido, then the system shall
  convergir para um estado aberto ou fechado completo sem sombra residual.

## Critérios de Aceite

- [x] Onboarding e configuração administrativa usam uma única superfície que
      pede somente a chave da OpenRouter e não exibe seletores de modelo.
- [x] Chave válida persiste atomicamente todos os padrões; chave inválida ou
      incompleta preserva a configuração anterior.
- [x] A chave permanece cifrada, nunca retorna pela API e não aparece em logs,
      mensagens de erro ou telemetria.
- [x] Testes de roteamento confirmam PDF via Mistral/OpenRouter, demais
      documentos via MarkItDown e imagens via OpenRouter.
- [x] O runtime e a imagem de produção não incluem nem acionam transcrição
      local.
- [x] Todo conteúdo novo elegível agenda tags idempotentes; falhas não revertem
      a ingestão e podem ser reconciliadas.
- [x] Cache, service worker, HTML e assets usam a mesma versão canônica, sem
      mistura entre builds e com limpeza de caches obsoletos.
- [x] Toasts permanecem visíveis por cinco segundos, aparecem um por vez e
      preservam ordem FIFO inclusive sob chegada simultânea e dispensa manual.
- [x] Snapshot, SSE e polling da Fila atualizam dados sem remount global,
      skeleton periódico, perda de foco, salto de rolagem ou reinício de
      animação.
- [x] Respostas de polling anteriores ao último evento SSE não fazem o progresso
      visual retroceder.
- [x] Atualização sem mudança semântica na Fila preserva referências e não causa
      renderização visual observável.
- [x] Gestos iniciados em tabelas, canvas, regiões horizontais, elementos
      editáveis, focáveis ou controles ARIA não movimentam a sidebar.
- [x] Fechamento, cancelamento e movimento reduzido deixam a sidebar sem sombra,
      backdrop ou transformação residual.
- [x] Testes unitários e de integração cobrem configuração concorrente,
      roteamento de ingestão, tags, versão/cache, fila de toasts, reconciliação
      da Fila e conflitos de gesto mobile.
- [x] Logs e métricas permitem correlacionar job, etapa, duração e resultado sem
      expor segredo ou conteúdo do usuário.
- [ ] Lint, formatação, typecheck, testes TypeScript/Python, build e verificações
      de segurança bloqueantes passam no CI; auditorias informativas permanecem
      registradas separadamente.

## Fora de Escopo

- Adicionar provedores de IA além da OpenRouter.
- Permitir seleção manual de modelos por capacidade.
- Adicionar transcrição local, CUDA, Whisper ou binários de inferência.
- Adicionar novos formatos de documento além dos já suportados.
- Alterar a biblioteca de fila, o broker Redis ou a arquitetura do worker.
- Redesenhar visualmente a Fila, a sidebar ou o sistema de toasts.
- Garantir ingestão quando OpenRouter ou serviços externos estiverem
  indisponíveis.

## Riscos / Decisões pendentes

- A configuração unificada substitui o contrato anterior de seleção
  administrativa por capacidade; customização manual de modelos fica fora desta
  entrega.
- A retenção offline deve priorizar consistência de versão. Se não houver cache
  completo e compatível, falhar explicitamente é preferível a misturar builds.
- A Fila pode atualizar contadores de tempo localizados, mas esses relógios não
  justificam reconciliar ou remontar a lista inteira.
- Regiões horizontais precisam declarar ou expor semântica detectável para que o
  gesto da sidebar ceda prioridade de forma determinística.
