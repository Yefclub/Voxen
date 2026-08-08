# Conectar clientes ao Voxen pelo MCP

[English](en/MCP.md) | Português (Brasil)

O Voxen expõe a Base de conhecimento de cada usuário aprovado por um servidor
remoto do [Model Context Protocol](https://modelcontextprotocol.io/). O endpoint
usa Streamable HTTP e cada credencial fica vinculada a exatamente um usuário.

## Dados da conexão

| Campo        | Valor                                               |
| ------------ | --------------------------------------------------- |
| Endpoint     | `https://SEU-HOST-VOXEN/mcp`                        |
| Transporte   | Streamable HTTP                                     |
| Autenticação | `Authorization: Bearer TOKEN_MCP_VOXEN`             |
| Escopo READ  | Buscar e ler a Base de conhecimento do proprietário |
| Escopo WRITE | Criar/editar notas e solicitar ingestões            |

Crie o token em **Sua conta → Acesso MCP**. O segredo aparece uma única vez.
Guarde-o em um gerenciador de senhas ou variável de ambiente secreta. Nunca o
coloque em URL, commit, log, ID de cliente OAuth ou campo de client secret.
Revogar o token não encerra o seu login no Voxen.

Comece com somente leitura. Habilite escrita apenas para um cliente que
realmente precise modificar sua base e cujo comportamento de aprovação você
conheça.

## Matriz de compatibilidade

“Documentado” significa que o fornecedor documenta o transporte/autenticação;
não significa que todas as versões foram validadas manualmente contra o Voxen.

| Cliente                       | Streamable HTTP |    Bearer pessoal    |  OAuth discovery  | Estado atual no Voxen                  |
| ----------------------------- | :-------------: | :------------------: | :---------------: | -------------------------------------- |
| Codex CLI/app/extensão        |       Sim       |         Sim          |        Sim        | Configuração por token documentada     |
| Claude Code                   |       Sim       |         Sim          |        Sim        | Configuração por token documentada     |
| OpenAI Responses API          |       Sim       |   Header suportado   |  Gerido pelo app  | Configuração server-side documentada   |
| Anthropic Messages API        |       Sim       | Token de autorização |  Gerido pelo app  | Configuração server-side documentada   |
| Cursor                        |       Sim       | UI varia por versão  |        Sim        | Usar OAuth após validação do Voxen     |
| MCP Inspector/SDK genérico    |       Sim       |         Sim          | Varia por cliente | Caminho de smoke test do protocolo     |
| Conector customizado Grok Web |       Sim       |    Não é exposto     |    Obrigatório    | **Não suportado até o OAuth do Voxen** |

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

Reinicie o Codex e confira `/mcp`. Quando o OAuth do Voxen estiver habilitado,
`codex mcp login voxen` será o caminho OAuth; ele não é necessário no fluxo de
token pessoal acima.

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

O Cursor documenta Streamable HTTP remoto e OAuth. A superfície de header
customizado mudou entre versões, por isso o Voxen não publica um `mcp.json` com
token como se fosse universal. Se a sua versão oferecer explicitamente um
header Authorization secreto, use o endpoint e Bearer acima. Nunca anexe o
token à URL.

Caso contrário, aguarde o OAuth do Voxen e use o fluxo OAuth normal do Cursor.
Ao reportar compatibilidade, informe a versão e o resultado.

## Grok Web

Conectores customizados do Grok Web exigem endpoint HTTPS público e OAuth. O
formulário pede credenciais de aplicação e endpoints OAuth. Um token pessoal do
Voxen não preenche esses campos.

Estado atual: **não suportado**. Não cole `vxn_mcp_...` como client ID ou client
secret. A interoperabilidade OAuth 2.1 está na
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

## Diagnóstico

### `401 Unauthorized`

- Confirme `Authorization: Bearer <token>` exatamente.
- Crie outro token se perdeu o segredo; ele não pode ser reexibido.
- Confira expiração/revogação e se a conta dona continua aprovada e ativa.

### `403 Forbidden`

- Um `Origin` de browser diferente de `APP_BASE_URL` é recusado.
- O proxy deve preservar scheme/host públicos; `APP_BASE_URL` deve ser a URL
  externa canônica.

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
- Um túnel publica o endpoint, mas não adiciona OAuth.

### Discovery ou transporte

- Use o path `/mcp` e Streamable HTTP, não SSE legado.
- Libere `POST`, Authorization, Content-Type, Accept e headers MCP no proxy/WAF.
- Teste `/health` e depois o curl acima.
- Até a entrega OAuth, clientes somente OAuth falharão mesmo quando o token
  pessoal funcionar em clientes que aceitam header.

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
