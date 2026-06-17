# 034 — Sidebar, chat contextual e prompt MCP

## Contexto

O Voxen já possui um fluxo PWA/mobile, chat contextual por transcrição e uma página administrativa de integrações. Esta spec cobre ajustes de produto focados em reduzir ruído visual, melhorar a interação mobile e facilitar a configuração de agentes externos via MCP.

## Escopo

- Mover as informações de versão para dentro da sidebar e remover o atalho `(?)` do canto direito.
- Redesenhar o balão/painel de chat contextual de transcrição com identidade visual do Voxen, menor cara de template genérico e melhor comportamento em smartphones.
- Manter e, se necessário, refinar a implementação progressiva de View Transition para navegação do SPA.
- Adicionar em `/admin/integracoes` uma ação de copiar prompt para agentes de IA com token MCP, URL atual da aplicação e instruções de uso seguro.

## Requisitos

### R1 — Versão na sidebar

- WHEN o usuário abrir a aplicação autenticada THEN as informações de versão/build SHALL aparecer dentro da sidebar.
- WHEN a versão estiver acessível na sidebar THEN o botão `(?)` do canto direito SHALL NOT ser renderizado.
- WHEN os metadados de versão não estiverem disponíveis THEN a sidebar SHALL manter layout estável e exibir fallback discreto.

### R2 — Chat contextual de transcrição

- WHEN o usuário abrir uma transcrição THEN o chat contextual SHALL ser acessado por botão flutuante com identidade do Voxen.
- WHEN o chat estiver aberto em viewport mobile THEN o painel SHALL caber na tela sem rolagem horizontal.
- WHEN o usuário interagir com o chat THEN o componente SHALL preservar o fluxo existente de mensagens, loading e envio contextual para a transcrição.
- WHEN houver conteúdo do assistente ou do usuário THEN a hierarquia visual SHALL priorizar mensagens e ações rápidas, com menos texto ornamental.

### R3 — Prompt MCP para agentes

- WHEN um admin acessar `/admin/integracoes` e houver token MCP ativo THEN a tela SHALL permitir copiar um prompt completo para agentes externos.
- WHEN o prompt for copiado THEN ele SHALL incluir a URL atual da aplicação, o endpoint MCP, o token ativo e instruções objetivas de autenticação e uso.
- WHEN não houver token MCP ativo THEN a ação SHALL orientar o admin a gerar o token antes de copiar o prompt.
- WHEN o backend gerar o prompt THEN ele SHALL exigir sessão admin, validar a origem informada e não registrar o token em logs.

### R4 — View Transition

- WHEN o browser suportar `document.startViewTransition` THEN navegações internas do SPA SHALL usar transições progressivas.
- WHEN o usuário preferir movimento reduzido ou o browser não suportar a API THEN a navegação SHALL continuar funcional sem animação customizada.

## Fora de escopo

- Criar novo provedor MCP ou alterar o contrato JSON-RPC existente.
- Adicionar dependências de animação apenas para o chat.
- Alterar o sistema de autenticação ou permissões administrativas.
