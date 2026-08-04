# Spec 160 — SSO OIDC administrado pela instância

## Status

Aprovado pelo owner em 2026-08-03 como parte do estudo de produto e da
implementação integral autorizada.

## Contexto

O Voxen já separa o trabalho cotidiano, a conta pessoal e a administração da
instância, mas o acesso ainda depende de e-mail e senha locais. Organizações que
distribuem usuários por um provedor de identidade precisam de login único sem
transformar uma credencial global em configuração pessoal nem permitir que um
usuário comum registre seu próprio emissor.

Esta spec introduz OpenID Connect (OIDC) como primeiro protocolo de SSO. Os
provedores pertencem à instância e são administrados em uma superfície dedicada;
as identidades resultantes continuam submetidas ao mesmo estado de aprovação,
bloqueio e isolamento de workspace já aplicado às contas locais.

## Glossário

- **Provedor OIDC**: configuração global que identifica um emissor, suas origens,
  credenciais de cliente e domínios de e-mail autorizados.
- **Identidade federada**: vínculo entre uma conta Voxen e o identificador estável
  emitido por um provedor OIDC.
- **Novo usuário federado**: identidade válida cujo e-mail ainda não pertence a
  uma conta Voxen.
- **Rota de gestão**: operação que cria, lista, altera, verifica ou exclui um
  provedor; não inclui iniciar login nem receber o callback do emissor.

## Requisitos

### Ubíquos

- The system shall tratar toda configuração de provedor OIDC como configuração
  global da instância, nunca como preferência ou credencial de um usuário comum.
- The system shall permitir que somente administradores aprovados criem, listem,
  alterem, verifiquem ou excluam provedores OIDC.
- The system shall manter e-mail e senha locais disponíveis, inclusive quando
  houver provedores OIDC configurados.
- The system shall cifrar o segredo de cliente OIDC em repouso e shall nunca
  devolvê-lo em APIs, HTML, logs, auditoria ou mensagens de erro.
- The system shall não persistir access token, refresh token ou ID token recebido
  do emissor após concluir a autenticação, pois o Voxen não os usa para consumir
  APIs externas.
- The system shall vincular uma identidade federada pelo par imutável provedor +
  identificador do sujeito, mantendo o workspace associado ao `userId` Voxen.
- The system shall aceitar somente emissores HTTPS e endpoints descobertos ou
  informados que atendam à política de origens confiáveis da instância.
- The system shall exigir os escopos OIDC mínimos `openid`, `email` e `profile` e
  shall validar assinatura, emissor, audiência, `state` e PKCE antes de aceitar a
  identidade.

### Orientados a evento

- When um administrador abre a administração de autenticação, the system shall
  exibir os provedores OIDC globais, seu estado e as URLs de callback necessárias,
  sem misturá-los com integrações de conteúdo ou conta pessoal.
- When um administrador cadastra um provedor, the system shall validar
  identificador, emissor, domínios, client ID, segredo e descoberta OIDC antes de
  persistir qualquer mudança.
- When um administrador altera um provedor sem informar um novo segredo, the
  system shall preservar o segredo existente sem reexibi-lo.
- When um administrador altera emissor, client ID ou mapeamento do
  sujeito de um provedor que já possui identidades vinculadas, the system shall
  recusar a mudança para não trocar silenciosamente a fronteira de identidade.
- When um visitante informa um e-mail coberto por um provedor ativo, the system
  shall iniciar o login no provedor correspondente e retornar somente para uma
  URL interna confiável.
- When o callback OIDC confirma uma identidade cujo e-mail verificado já pertence
  a uma conta Voxen e o domínio corresponde ao provedor, the system shall vincular
  a identidade à conta existente sem criar workspace duplicado.
- When o callback OIDC confirma uma identidade ainda inexistente e novos cadastros
  estão permitidos, the system shall criar a conta como `PENDING`, sem papel de
  administrador e sem liberar sessão até aprovação administrativa.
- When um administrador aprova um novo usuário federado, the system shall permitir
  o próximo login OIDC e preservar o mesmo fluxo de gestão disponível para
  usuários locais.
- When um provedor é excluído, the system shall impedir novos logins por ele sem
  excluir a conta Voxen, o workspace ou outros métodos de acesso já vinculados.

### Orientados a estado

- While novos cadastros estiverem desativados, the system shall permitir login de
  identidades federadas já vinculadas e shall recusar o provisionamento de novas
  contas por qualquer provedor.
- While uma conta estiver `PENDING`, `REJECTED` ou `DISABLED`, the system shall
  negar a criação de sessão OIDC exatamente como nega uma sessão local.
- While um provedor não estiver ativo ou sua configuração não estiver válida, the
  system shall não oferecê-lo como método de login.
- While o domínio declarado pelo provedor não estiver comprovado ou não
  corresponder ao e-mail verificado devolvido pelo emissor, the system shall não
  vincular nem provisionar a identidade.
- While uma conta possuir mais de um método de acesso, the system shall manter um
  único usuário, um único papel, um único estado de aprovação e um único workspace.

### Opcionais

- Where existirem vários provedores ativos, the system may resolver o provedor
  pelo domínio do e-mail e may também apresentar opções identificadas na tela de
  login, sem expor dados secretos.

### Comportamentos indesejados

- If um usuário não administrador chamar uma rota de gestão, then the system
  shall responder com acesso negado sem revelar se o provedor existe.
- If alguém chamar diretamente uma rota de gestão fornecida pela camada de
  autenticação, then the system shall bloqueá-la; toda gestão deve passar pelo
  contrato administrativo do Voxen.
- If descoberta, troca de token ou consulta de perfil tentar acessar origem não
  confiável, endereço privado não autorizado, redirecionamento inesperado ou
  protocolo diferente de HTTPS, then the system shall falhar fechado.
- If o emissor devolver e-mail não verificado, domínio divergente, sujeito vazio,
  estado inválido ou token inválido, then the system shall negar autenticação sem
  criar vínculo, sessão ou privilégio.
- If o cadastro estiver fechado e a identidade federada ainda não existir, then
  the system shall negar o provisionamento sem impedir o login de usuários já
  vinculados.
- If dois provedores reivindicarem o mesmo domínio, then the system shall recusar
  a configuração ambígua.
- If o administrador excluir ou rotacionar um segredo, then the system shall não
  registrar o valor anterior ou novo no histórico de configuração.

## Critérios de aceite

- [x] Existe uma rota administrativa dedicada para autenticação/SSO, visível
      apenas a administradores e distinta de `/admin/integracoes`.
- [x] Administradores conseguem criar, consultar, atualizar e excluir múltiplos
      provedores OIDC; respostas mostram apenas metadados e indicação de segredo
      configurado.
- [x] As rotas diretas de gestão da camada de autenticação estão bloqueadas para
      visitantes, usuários comuns e administradores; as rotas públicas mínimas de
      início e callback continuam funcionais.
- [x] O segredo de cliente está cifrado no banco e é decifrado somente em memória
      durante operações OIDC; tokens recebidos do emissor não ficam persistidos.
- [x] Descoberta e endpoints OIDC falham fechado para origens/protocolos não
      confiáveis e a configuração inválida não substitui a configuração válida.
- [x] Login local continua funcional com e sem provedores configurados.
- [x] Usuário OIDC novo nasce `PENDING`, não recebe sessão e aparece no controle
      administrativo; após aprovação, autentica no mesmo workspace.
- [x] `allow_signups=false` bloqueia somente novos usuários OIDC, sem bloquear
      identidades previamente vinculadas.
- [x] E-mail verificado e domínio autorizado vinculam com segurança uma conta
      existente; e-mail não verificado ou domínio divergente falham sem duplicar
      conta ou workspace.
- [x] Estados `PENDING`, `REJECTED` e `DISABLED` impedem sessão OIDC e a remoção do
      último administrador aprovado continua protegida.
- [x] A migration da tabela de provedores passa no gate de migrations em banco
      vazio e no caminho de upgrade da linha de base.
- [x] Testes de rota, autorização, isolamento, criptografia, redaction, cadastro,
      vínculo, bloqueio e regressão de login local passam, junto de lint,
      typecheck, build e suites relevantes.

## Fora de escopo

- SAML, SCIM, sincronização de grupos/papéis e desprovisionamento iniciado pelo
  provedor de identidade.
- Tornar SSO obrigatório ou remover o acesso local de emergência.
- Permitir que um usuário comum registre ou administre provedores.
- Usar tokens OIDC para consumir APIs do provedor após o login.
- Promover automaticamente usuário federado a administrador.

## Decisões aprovadas

- OIDC é o primeiro protocolo por ser interoperável, baseado em descoberta e
  suficiente para o objetivo atual; SAML permanece uma evolução separada.
- A configuração é global e compartilhada entre administradores, não pertence ao
  administrador que a criou.
- A tela vive no domínio de administração de autenticação, evitando ampliar a já
  genérica tela de integrações.
- Segurança prevalece sobre conveniência: domínio comprovado, e-mail verificado,
  segredo cifrado, tokens não persistidos e rotas de gestão fechadas são partes
  do contrato, não ajustes opcionais.
- No authorization code flow, o `nonce` permanece opcional pelo OpenID Connect
  Core. A integração oficial adotada pelo Voxen protege o callback com `state` e
  PKCE e valida assinatura, emissor e audiência do ID token; exigir um `nonce`
  fora do contrato suportado pelo plugin não acrescentaria uma garantia que a
  implementação pudesse verificar de ponta a ponta.
- PKCE é obrigatório em todos os provedores. A administração não expõe uma opção
  para enfraquecer o fluxo e a API rejeita explicitamente `pkce=false`.
- A validação DNS ocorre antes da requisição HTTP e o cliente resolve o hostname
  novamente, portanto existe uma janela residual de DNS rebinding entre as duas
  operações. O impacto é reduzido por HTTPS com validação do hostname/certificado,
  recusa de redirects, cache positivo curto e limite por IP no callback. Uma
  evolução futura pode fixar o endereço validado no transporte para eliminar a
  janela por completo.
