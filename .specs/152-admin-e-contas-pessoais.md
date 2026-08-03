# Spec 152 — Administração, contas pessoais de plataforma e defaults de IA

## Contexto

As configurações de infraestrutura e modelos pertencem à administração da instância, enquanto a sessão de TikTok, Instagram ou YouTube é uma credencial individual do usuário que captura o conteúdo. Atualmente, as contas de plataforma ficam na tela administrativa e compartilham um único segredo global, o que permite que a conta de uma pessoa seja usada no job de outra. Esta mudança separa visualmente os domínios e isola a credencial e o consumo por `userId`.

Os defaults canônicos de IA precisam refletir os modelos escolhidos para cada finalidade sem alterar os demais slots nem sobrescrever uma configuração já escolhida pelo administrador.

## Glossário

- **Configuração global**: credencial, modelo ou ajuste da instância, alterável apenas por ADMIN.
- **Conta de plataforma**: cookies de sessão de uma plataforma, ligados a um único usuário autenticado.
- **Conta legada global**: cookies já presentes em `Setting(scope=GLOBAL)` antes desta spec; não têm proprietário verificável.

## Requisitos

### Ubíquos

- O sistema shall manter as configurações de IA, MCP, proxy e revisões exclusivamente em `/admin/integracoes`.
- O sistema shall expor as contas de plataforma numa rota pessoal acessível a todo usuário aprovado.
- O sistema shall nunca devolver, registrar em log ou incluir em mensagens de erro o conteúdo de cookies de plataforma.
- O sistema shall obter o `userId` exclusivamente da sessão autenticada para toda leitura, escrita, revogação e uso de cookies.
- O sistema shall manter `default_x_analysis_model` e `default_transcription_model` inalterados nos defaults canônicos.

### Orientados a evento

- When um usuário conectar uma plataforma pela extensão, o sistema shall gravar os cookies cifrados como `Setting(scope=USER, userId=<sessão>)`.
- When um usuário consultar ou revogar uma plataforma, o sistema shall afetar somente os cookies associados ao `userId` da sessão.
- When um job de mídia for processado, o worker shall materializar somente os cookies do dono do job.
- When a rota começar com `/admin/` ou for `/setup`, o cliente shall redirecionar um não-admin para a área pessoal sem montar a tela administrativa.
- When uma instância nova ou um slot ainda sem configuração usar o default canônico, o sistema shall usar `deepseek/deepseek-v4-flash-0731` para Chat e Busca na web e `openai/gpt-5.6-luna` para Documentos e Visão.

### Orientados a estado

- While a conta pessoal de uma plataforma estiver conectada, o status shall mostrar apenas plataforma, presença, data de captura e expiração provável do próprio usuário.
- While não houver conta pessoal conectada, o sistema shall informar que a captura deve ser feita pela extensão no perfil de navegador do usuário.
- While houver cookies globais legados, o sistema shall preservá-los cifrados e não os associará automaticamente a nenhum usuário nem os usará em jobs novos.

### Opcionais

- Where o usuário for ADMIN, o shell may exibir simultaneamente os destinos pessoais e os destinos administrativos, com rotas e rótulos distintos.

### Comportamentos indesejados

- If um usuário tentar acessar ou usar cookies de outro usuário, o sistema shall negar esse acesso por escopo de consulta e não aplicar fallback global.
- If a captura for inválida, o sistema shall manter intacta a conta pessoal previamente salva.
- If uma configuração global de modelo já tiver sido persistida pelo administrador, o sistema shall não a sobrescrever apenas por atualizar os defaults canônicos.

## Critérios de aceite

- [ ] `/admin/integracoes` não contém o painel nem as rotas de "Saúde da configuração de IA".
- [ ] `/admin/integracoes` não contém "Contas de plataforma"; a área pessoal contém esse fluxo.
- [ ] A extensão usa a rota pessoal e admite usuários aprovados, sem exigência de ADMIN.
- [ ] Duas sessões de usuários diferentes recebem status e dados independentes; revogar uma não altera a outra.
- [ ] O worker recebe o `userId` do job em todas as operações do yt-dlp que podem usar cookies.
- [ ] Os novos defaults são aplicados apenas a Chat, Busca na web, Documentos e Visão.
- [ ] Há testes de rota, isolamento, worker e defaults; lint, typecheck e suites relevantes passam.
- [ ] O fluxo pessoal e o bloqueio de rota administrativa são validados visualmente em browser.

## Fora de escopo

- Migrar automaticamente cookies globais legados para um usuário sem prova de propriedade.
- Alterar manualmente os modelos já configurados por um administrador.
- Alterar os slots de transcrição ou análise do X.

## Decisões

- Reutilizar `Setting(scope=USER)` para evitar uma nova tabela e preservar o mesmo envelope AES-256-GCM que o worker já sabe decifrar.
- Manter a captura no perfil de browser da extensão; o token/sessão da extensão identifica o usuário do Voxen, e não a conta da plataforma.
- Remover a superfície e a API de saúde de IA por completo, em vez de apenas escondê-las.
