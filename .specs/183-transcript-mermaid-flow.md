# Spec 183 — Fluxos Mermaid de transcrições

## Contexto

A Voxen já preserva a transcrição canônica e o resumo fundamentado, mas não oferece uma
representação visual revisável das relações, decisões e sequências descritas no conteúdo.
Diagramas gerados por modelo também são conteúdo não confiável: uma renderização permissiva
poderia introduzir links, diretivas ou HTML fora do domínio da base de conhecimento.

Esta entrega adiciona geração explícita de um fluxo Mermaid separado do resumo, renderização
segura no Markdown e leitura pelas ferramentas da própria Voxen, sem tornar o diagrama uma
fonte factual independente.

## Glossário

- **Fluxo**: diagrama Mermaid fundamentado somente na transcrição e no resumo canônico.
- **Fonte canônica**: texto persistido da transcrição, que permanece a autoridade factual.
- **Fallback seguro**: exibição do código do diagrama quando ele não puder ser validado ou
  renderizado.

## Requisitos

### Ubiquitous

- The system shall armazenar o fluxo separadamente do resumo e da transcrição canônica.
- The system shall limitar cada fluxo a 12.000 caracteres e 80 nós.
- The system shall tratar todo código Mermaid gerado por modelo como conteúdo não confiável.
- The system shall impedir HTML, links clicáveis, callbacks, diretivas de inicialização e
  carregamento de recursos externos em diagramas.
- The system shall isolar leitura, geração e atualização do fluxo pelo usuário autenticado.
- The system shall expor o fluxo persistido nas leituras completas de transcrição do chat e do
  MCP, identificado como representação visual derivada.

### Event-driven

- When o usuário solicitar a geração de um fluxo, the system shall usar somente título, resumo
  e texto da transcrição pertencente ao seu workspace.
- When a geração for concluída, the system shall validar o código antes de persistir e retornar
  o fluxo.
- When o usuário solicitar regeneração de um fluxo existente, the system shall exigir uma
  confirmação explícita e substituir somente o fluxo derivado.
- When um bloco Markdown válido e completo usar a linguagem `mermaid`, the system shall
  renderizá-lo em um canvas visual responsivo e compatível com o tema selecionado da Voxen.
- When a geração consumir um modelo, the system shall registrar modelo, tokens, custo, idioma,
  usuário e transcrição na telemetria de custos.

### State-driven

- While a geração estiver em andamento, the system shall desabilitar ações duplicadas e mostrar
  o estado de processamento.
- While o canvas exceder o espaço disponível, the system shall permitir navegação sem bloquear
  a rolagem vertical da página.

### Optional

- Where uma transcrição ainda não possuir fluxo, the system shall oferecer uma ação explícita
  de geração sem alterar o resumo existente.
- Where o renderer não suportar ou não concluir o diagrama, the system shall mostrar o fallback
  seguro com o código copiável.

### Unwanted behavior

- If a transcrição não existir, estiver na lixeira ou pertencer a outro usuário, then the system
  shall negar a operação sem revelar sua existência.
- If o texto canônico estiver vazio, then the system shall rejeitar a geração sem chamar o
  provedor de IA.
- If o provedor retornar texto vazio, sintaxe fora do formato aceito ou conteúdo proibido, then
  the system shall rejeitar o resultado e preservar o fluxo anterior.
- If um diagrama exceder os limites de tamanho ou nós, then the system shall usar o fallback
  seguro e nunca tentar renderizá-lo.
- If uma ação de geração for repetida antes do intervalo permitido, then the system shall
  rejeitá-la com tempo de nova tentativa.

## Critérios de Aceite

- [x] Existe persistência separada e migration para o fluxo derivado.
- [x] A API de geração/regeneração valida ownership, conteúdo, confirmação e rate limit.
- [x] Saídas proibidas, grandes, vazias ou malformadas não são persistidas.
- [x] A interface da transcrição permite gerar, copiar e regenerar o fluxo.
- [x] O renderer exibe Mermaid válido e usa fallback seguro para conteúdo inválido ou incompleto.
- [x] O canvas acompanha os temas da aplicação e não bloqueia o scroll vertical no mobile.
- [x] As leituras completas do chat e MCP incluem o fluxo derivado quando presente.
- [x] A telemetria registra o custo sem armazenar segredos ou texto integral da transcrição.
- [x] Testes cobrem isolamento, confirmação, limites, conteúdo proibido, persistência, fallback e
  contratos da interface.

## Fora de Escopo

- Edição visual de nós e arestas.
- Uso do fluxo como substituto da transcrição, evidência ou entrada automática do grafo.
- Geração automática em toda ingestão.
- Execução de links, callbacks ou scripts descritos no Mermaid.

## Riscos / Decisões pendentes

- O renderer deve ser carregado sob demanda para não penalizar páginas sem diagramas.
- O fluxo continua sendo uma interpretação derivada e pode ser regenerado; a fonte canônica não
  é alterada.

> 2026-08-08: escopo aprovado pelo owner ao autorizar a implementação de Mermaid e fluxos com
> interface para o conteúdo resumido.
