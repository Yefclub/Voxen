# Conectar clientes ao Voxen pelo MCP

[English](en/MCP.md) | Português (Brasil)

O Voxen expõe a Base de conhecimento de cada usuário aprovado por um servidor
remoto do [Model Context Protocol](https://modelcontextprotocol.io/). O endpoint
usa Streamable HTTP e cada credencial fica vinculada a exatamente um usuário.

O mesmo endpoint suporta o protocolo **2026-07-28** e os clientes de 2025.
Clientes atuais usam descoberta e metadados por chamada; os anteriores mantêm
o handshake `initialize`. As chamadas devem aceitar JSON e SSE, e o corpo tem
limite de 1 MiB. Não há streams de sessão GET/DELETE nem assinaturas; as
ferramentas são chamadas por POST.

## Dados da conexão

| Campo        | Valor                                               |
| ------------ | --------------------------------------------------- |
| Endpoint     | `https://SEU-HOST-VOXEN/mcp`                        |
| Transporte   | Streamable HTTP                                     |
| Autenticação | Token Bearer pessoal ou OAuth 2.1 + PKCE            |
| Escopo READ  | Buscar e ler a Base de conhecimento do proprietário |
| Escopo WRITE | Criar/editar notas e solicitar ingestões            |

Crie o token em **Sua conta → Acesso MCP**. O segredo aparece uma única vez.
Guarde-o em um gerenciador de senhas ou variável de ambiente secreta. Nunca o
coloque em URL, commit, log, ID de cliente OAuth ou campo de client secret.
Revogar o token não encerra o seu login no Voxen.

Comece com somente leitura. Habilite escrita apenas para um cliente que
realmente precise modificar sua base e cujo comportamento de aprovação você
conheça.

Novos tokens usam **READ** e expiram em **90 dias** por padrão. Escolha WRITE e/ou
um token sem expiração de forma explícita. Tokens existentes e concessões OAuth
mantêm suas configurações. A ação do admin cria um token adicional; revogar é uma
ação separada. Prompts copiados contêm instruções e uma variável de ambiente,
nunca o segredo Bearer.

## Contratos de execução e resultados

O catálogo tem **44 ferramentas: 31 READ e 13 WRITE**, com escopos, anotações de
efeitos e schemas de saída validados. `voxen_get_job_status` é READ, inclusive
para jobs enviados por um cliente com escrita. Os metadados informam a versão
real do Voxen em execução.

Argumentos desconhecidos são rejeitados. Consultas têm limite de 2.000 caracteres,
identificadores de 256, listas de 100 itens e argumentos aninhados de 10 níveis;
cada ferramenta pode ter limites menores. IDs RPC aceitam strings de até 128
caracteres ou inteiros seguros. O prazo de 30 segundos começa na leitura do corpo
e inclui autenticação e execução. Consultas pesadas do grafo têm limite de 3
segundos no PostgreSQL.

Respostas de ferramentas têm limite de 96 KiB. Resultados pequenos mantêm o
contrato normal. READ grandes retornam `dataChunk` e metadados `_mcp`: `format`
é `application/json`, `offsetUnit` é `utf16`, `resultChecksum` identifica o JSON
completo e `nextCursor` é a continuação assinada. Repita a mesma ferramenta e os
argumentos originais com `content_cursor: nextCursor`, concatene os `dataChunk`
em ordem e só interprete o JSON quando `nextCursor` virar null. Cada página
confere novamente propriedade e ciclo de vida. Conteúdo alterado, outro usuário/
ferramenta/filtro ou cursor expirado exigem reiniciar sem `content_cursor`.
O cursor vale cinco minutos; cada página seguinte renova o prazo. Resultados
completos acima de 16 MiB exigem uma página menor ou um trecho progressivo.

WRITE grandes retornam `summary` limitado e instruções READ em `_mcp.followUp`.
`toolExecution: completed` indica que a chamada terminou; um job enfileirado ainda
precisa ser acompanhado. `applied: false` indica que o preview não aplicou escrita.
WRITE nunca aceita `content_cursor`. Confira o estado atual antes de repetir uma
escrita com resultado incerto.

Listagens de notas/transcrições usam cursores assinados em `nextCursor`, por data
de criação decrescente e depois ID decrescente. Excluir o limite de uma página ou
editar um item não desloca as páginas seguintes; novos itens mais recentes
aparecem ao reiniciar a listagem. Preserve o filtro original. Cursores antigos de
offset são rejeitados com instruções de reinício.

A proteção permite 600 chamadas/minuto por usuário, 1.200 por conexão e 6.000 no
servidor. Ela usa o endereço TCP observado, sem confiar em headers encaminhados
pelo cliente. Há quatro ferramentas ativas por usuário e dezesseis no servidor;
callbacks que excederam o prazo mantêm a vaga até realmente terminarem. HTTP
429/503 inclui `Retry-After`. Credenciais inválidas retornam 401; indisponibilidade
da autenticação/proteção retorna 503. Erros de ferramentas usam códigos seguros
e `requestId`, sem detalhes de banco, caminhos ou credenciais.

Auditoria OAuth mantém até 30 dias e os 20.000 registros mais recentes, com limpeza
por minuto em lotes limitados. Logs de ferramentas registram nome, duração,
resultado e identificadores não secretos; não registram argumentos, conteúdo ou
Bearer. Configure `APP_BASE_URL` canônica válida em produção. Sem ela, o MCP
bloqueia o acesso; desenvolvimento aceita somente origem/host local compatível.

A suíte de protocolo testa SDKs 2.3.1 (atual) e 1.32.1 (legado). Integrações com
contas de produtos específicos ainda exigem testes reais. Clientes hospedados
precisam alcançar seu HTTPS pela rede deles; regras geográficas do firewall
também se aplicam a esses serviços.

## Contexto pessoal e grafo

Credenciais com leitura expõem `voxen_personal_context`. A ferramenta reúne,
em um contrato limitado e versionado, feedback explícito, interesses inferidos
por atividade, tendências e fontes priorizadas pelo grafo. Os campos
`provenance` diferenciam `DECLARED`, `INFERRED` e `MIXED`; `stance: LESS`
representa menor interesse e nunca é usado como semente positiva.

Esse contexto orienta descoberta e recomendações, mas não comprova fatos nem é
um perfil psicológico. O cliente deve abrir os links retornados, ler a fonte e
usar as ferramentas de verificação antes de afirmar seu conteúdo. O resultado
também informa versões dos algoritmos, watermark das projeções e se o recorte
do grafo ou do contexto foi truncado. Tokens somente `WRITE` não descobrem essa
ferramenta.

`voxen_brain_timeline` consulta relações temporais apoiadas por evidência. Sem
argumento de tempo, retorna fatos válidos agora, tenham eles fim desconhecido ou
um término futuro; `as_of` consulta um instante, enquanto `from`/`to` encontra
janelas sobrepostas. A
validade no domínio (`validFrom`/`validTo`) fica separada de `observedAt`, o
tempo representado pelo episódio-fonte. Se o conteúdo não declarar o tempo, ele
continua desconhecido — nunca é inferido pela data de ingestão. Aliases de
entidade melhoram a busca, mas continuam observações reversíveis; nomes
normalizados iguais não provocam fusão automática de identidades.

Relações temporais são conhecimento extraído, não comprovação isolada. Todo
resultado inclui evidência limitada da fonte, que deve ser lida/verificada
antes de apresentar a relação como fato. Relações sobrepostas ou conflitantes
devem ser mostradas como incerteza, sem consolidação silenciosa.

## Fluxo seguro para editar notas

As leituras de nota retornam uma `revision` monotônica e um `checksum` opaco.
Sempre que possível, o agente deve alterar somente o trecho necessário:

1. Use `voxen_search_notes` para encontrar a nota e
   `voxen_search_note_content` para localizar o trecho exato e sua ocorrência.
2. Chame `voxen_patch_note` com `preview_only: true`, a `expected_revision`
   observada e uma operação `replace`, `insert_before`, `insert_after`,
   `prepend` ou `append`.
3. Revise a prévia limitada. Aplique repetindo a chamada com
   `preview_only: false` somente se a revisão continuar atual.
4. Consulte o histórico imutável com `voxen_list_note_revisions` e
   `voxen_read_note_revision`. `voxen_restore_note_revision` cria uma nova
   revisão atual; nunca reescreve o histórico.

`voxen_update_note` continua disponível para compatibilidade e substituições
completas intencionais, mas também exige `expected_revision`. Um conflito exige
reler a nota e propor uma nova mudança; o agente nunca deve repetir cegamente.
Credenciais somente leitura não descobrem nem executam patch, restauração,
criação, atualização completa ou ingestão.

O administrador pode habilitar OAuth 2.1 em **Administração → Integrações → MCP
Server**. O acesso OAuth continua vinculado ao usuário Voxen que aprova o
consentimento; ele nunca herda acesso administrativo.

## Matriz de compatibilidade

“Documentado” significa que o fornecedor documenta o transporte/autenticação;
não significa que todas as versões foram validadas manualmente contra o Voxen.

| Cliente                       | Streamable HTTP |    Bearer pessoal    |  OAuth discovery  | Estado atual no Voxen                    |
| ----------------------------- | :-------------: | :------------------: | :---------------: | ---------------------------------------- |
| Codex CLI/app/extensão        |       Sim       |         Sim          |        Sim        | Token e OAuth documentados               |
| Claude Code                   |       Sim       |         Sim          |        Sim        | Configuração por token documentada       |
| OpenAI Responses API          |       Sim       |   Header suportado   |  Gerido pelo app  | Configuração server-side documentada     |
| Anthropic Messages API        |       Sim       | Token de autorização |  Gerido pelo app  | Configuração server-side documentada     |
| Cursor                        |       Sim       | UI varia por versão  |        Sim        | Fluxo OAuth disponível                   |
| MCP Inspector/SDK genérico    |       Sim       |         Sim          | Varia por cliente | Caminho de smoke test do protocolo       |
| Conector customizado Grok Web |       Sim       |    Não é exposto     |    Obrigatório    | Protocolo pronto; validação Web pendente |

As versões realmente testadas serão registradas nesta matriz. Um exemplo de
configuração, sozinho, não representa validação manual.

## Codex CLI, app e extensão de IDE

O Codex compartilha a configuração MCP entre CLI, app e extensão. Defina o
token no ambiente que inicia o Codex:

```bash
export VOXEN_MCP_TOKEN='cole-o-token-exibido-uma-vez'
```

Adicione em `~/.codex/config.toml` ou `.codex/config.toml` de projeto confiável:

```toml
[mcp_servers.voxen]
url = "https://SEU-HOST-VOXEN/mcp"
bearer_token_env_var = "VOXEN_MCP_TOKEN"
default_tools_approval_mode = "writes"
```

Reinicie o Codex e confira `/mcp`. Se o administrador habilitou OAuth, remova a
configuração Bearer e use `codex mcp login voxen`; o navegador pedirá login e
consentimento do usuário Voxen.

## Claude Code

O Claude Code aceita servidor HTTP remoto com header de autorização. Para não
gravar o segredo no histórico do shell nem em arquivos compartilhados, defina
`VOXEN_MCP_TOKEN` no ambiente e use em `.mcp.json`:

```json
{
  "mcpServers": {
    "voxen": {
      "type": "http",
      "url": "https://SEU-HOST-VOXEN/mcp",
      "headers": {
        "Authorization": "Bearer ${VOXEN_MCP_TOKEN}"
      }
    }
  }
}
```

Execute `claude mcp get voxen` e abra `/mcp` no Claude Code. Arquivos MCP de
projeto exigem que o workspace seja confiável.

## OpenAI Responses API

Mantenha o token no servidor da sua aplicação. A tool MCP remota aceita headers:

```json
{
  "type": "mcp",
  "server_label": "voxen",
  "server_url": "https://SEU-HOST-VOXEN/mcp",
  "headers": {
    "Authorization": "Bearer SEU_TOKEN_MCP_VOXEN"
  },
  "require_approval": "always"
}
```

Não envie o token para browser ou aplicativo móvel. Sua aplicação é responsável
por mantê-lo secreto e decidir quais ferramentas exigem aprovação.

## Anthropic Messages API

```json
{
  "type": "url",
  "url": "https://SEU-HOST-VOXEN/mcp",
  "name": "voxen",
  "authorization_token": "SEU_TOKEN_MCP_VOXEN"
}
```

Passe o objeto no array `mcp_servers`. Guarde o token no servidor e siga os
headers de versão/beta atuais do conector MCP da Anthropic.

## Cursor

O [guia oficial do Cursor](https://cursor.com/docs/mcp) documenta HTTP remoto,
OAuth e headers por variáveis de ambiente. Para OAuth, habilite-o no Voxen e use:

```json
{ "mcpServers": { "voxen": { "url": "https://SEU-HOST-VOXEN/mcp" } } }
```

Com token pessoal, use uma referência secreta no servidor:
`"headers": {"Authorization": "Bearer ${env:VOXEN_MCP_TOKEN}"}`. Nunca coloque a
credencial na URL. Registre a versão instalada e o resultado real; configuração
documentada não equivale a validar a conta do cliente.

## Descoberta OAuth 2.1 e clientes manuais

OAuth vem desativado por padrão. Depois de habilitado, clientes com descoberta
recebem apenas a URL normal `https://SEU-HOST-VOXEN/mcp`. O Voxen publica:

- Metadados do recurso: `/.well-known/oauth-protected-resource/mcp`
- Metadados do servidor: `/.well-known/oauth-authorization-server/api/auth`
- Autorização: `/api/auth/oauth2/authorize`
- Token: `/api/auth/oauth2/token`
- Registro dinâmico: `/api/auth/oauth2/register`

Clientes públicos usam Authorization Code + PKCE `S256`, com autenticação
`none` no token endpoint. Comece com `mcp:read`, adicione `mcp:write` somente
quando necessário e solicite `offline_access` para refresh. O access token dura
cinco minutos e o refresh token gira a cada uso. O usuário revoga acessos em
**Sua conta → Acesso MCP**. A revogação RFC 7009 também invalida o access token
imediatamente; o Voxen guarda somente seu identificador aleatório assinado de
curta duração.
Para clientes confidenciais, a introspecção RFC 7662 de access tokens JWT
aplica a mesma política dinâmica de usuário, consentimento, cliente e revogação
individual do endpoint MCP, preservando a introspecção de refresh tokens
opacos.

Se o cliente exigir um ID criado manualmente, obtenha primeiro a callback URI
exata mostrada por ele e peça para um administrador usar **Administração →
Integrações → MCP → Pré-registrar cliente OAuth**. Essa tela cria cliente
público com PKCE ou cliente confidencial e mostra o secret confidencial uma
única vez. Nunca adivinhe a redirect URI.

Clientes públicos também podem usar o registro dinâmico diretamente:

```bash
export VOXEN_URL='https://SEU-HOST-VOXEN'
export CLIENT_REDIRECT_URI='https://CALLBACK-EXATA-MOSTRADA-PELO-CLIENTE'
curl --fail-with-body "$VOXEN_URL/api/auth/oauth2/register" \
  -H 'Content-Type: application/json' \
  --data "{\"client_name\":\"Meu cliente MCP\",\"redirect_uris\":[\"$CLIENT_REDIRECT_URI\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"],\"scope\":\"mcp:read offline_access\"}"
```

Guarde o `client_id` retornado; cliente público com PKCE não tem client secret.
O Voxen exige redirect exato e só permite HTTP para callbacks loopback.

## Grok Web

Conectores customizados do Grok Web exigem endpoint HTTPS público e OAuth. O
formulário pede credenciais de aplicação e endpoints OAuth. Um token pessoal do
Voxen não preenche esses campos.

O Voxen já expõe o fluxo OAuth padronizado exigido por clientes hospedados, mas
o Grok Web permanece como **validação manual pendente** até um deploy público de
dev completar login, consentimento, troca de token e chamada real de tool. Não
cole `vxn_mcp_...` em client ID/secret. Se o Grok mostrar o formulário manual,
use um client ID público registrado, secret vazio, PKCE/`none` e os endpoints e
escopos acima. Se a interface não mostrar a callback URI exata, não adivinhe;
use descoberta automática ou registre a versão na
[issue #679](https://github.com/Yefclub/Voxen/issues/679).

## MCP Inspector e clientes genéricos

Envie o token no header Authorization em cada request. Smoke test mínimo:

```bash
curl --fail-with-body https://SEU-HOST-VOXEN/mcp \
  -H "Authorization: Bearer $VOXEN_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"voxen-smoke-test","version":"1.0.0"}}}'
```

No MCP Inspector, selecione Streamable HTTP, informe o endpoint e configure o
Authorization nos controles de autenticação/headers. Nunca use query parameter.

O teste de descoberta do protocolo atual inclui os headers obrigatórios e os
metadados de capacidades do cliente:

```bash
curl --fail-with-body https://SEU-HOST-VOXEN/mcp \
  -H "Authorization: Bearer $VOXEN_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  --data '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"voxen-smoke-test","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Chamadas atuais a `tools/call` também exigem que `Mcp-Name` corresponda a
`params.name`. Os clientes do SDK gerenciam metadados, headers e negociação de
versão automaticamente.

## Diagnóstico

### `401 Unauthorized`

- Confirme `Authorization: Bearer <token>` exatamente.
- Crie outro token se perdeu o segredo; ele não pode ser reexibido.
- Confira expiração/revogação e se a conta dona continua aprovada e ativa.
- Clientes OAuth devem ler `resource_metadata` no `WWW-Authenticate` e reiniciar
  a autorização após revogação do grant ou cliente.

### `403 Forbidden`

- Um `Origin` de browser diferente de `APP_BASE_URL` é recusado.
- O proxy deve preservar scheme/host públicos; `APP_BASE_URL` deve ser a URL
  externa canônica.
- Token OAuth sem `mcp:write` recebe `insufficient_scope` ao chamar diretamente
  uma tool de escrita.

### Tools ausentes ou escrita recusada

- `READ` expõe busca/leitura; `WRITE` expõe mutações.
- Uma tool de escrita não é registrada para token somente leitura; o cliente
  normalmente informa que ela está indisponível ou não foi encontrada, não 403.
- Crie token substituto com ambos apenas se precisar escrever.
- Reconecte após trocar credenciais; clientes podem manter a lista em cache.

### HTTPS, TLS e alcance público

- Clientes hospedados precisam de HTTPS público e certificado válido.
- `localhost`, IP privado e certificado autoassinado não funcionam em serviços
  hospedados do Grok/OpenAI/Anthropic.
- O túnel deve preservar o `APP_BASE_URL` canônico; trocar a URL pública exige
  novo registro OAuth.

### Discovery ou transporte

- Use o path `/mcp` e Streamable HTTP, não SSE legado.
- Libere `POST`, Authorization, Content-Type, Accept e headers MCP no proxy/WAF.
- Teste `/health` e depois o curl acima.
- Confira se o administrador habilitou OAuth; a descoberta continua descritiva,
  mas autorização e emissão falham de forma fechada quando desabilitado.

## Checklist de segurança

- Prefira tokens de leitura, com expiração e separados por dispositivo.
- Revogue imediatamente após exposição ou perda do dispositivo.
- Nunca envie tokens em issues, prints, URLs, histórico do shell ou arquivos
  versionados.
- Trate o conteúdo retornado por MCP como dado privado do workspace.
- Revise as aprovações de tools de escrita em cada cliente.

## Referências primárias

- [Autorização MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Configuração MCP do Codex](https://learn.chatgpt.com/docs/extend/mcp)
- [MCP no Claude Code](https://code.claude.com/docs/en/mcp)
- [Tools MCP remotas da OpenAI](https://platform.openai.com/docs/api-reference/responses/create)
- [Conector MCP da Anthropic](https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector)
- [MCP no Cursor](https://docs.cursor.com/context/model-context-protocol)
- [Conectores customizados do Grok](https://docs.x.ai/grok/connectors)
- [Debug e MCP Inspector](https://modelcontextprotocol.io/docs/tools/debugging)
