import type { Locale } from './i18n';

export type McpClientId =
  | 'codex'
  | 'claude'
  | 'openai'
  | 'anthropic'
  | 'cursor'
  | 'inspector'
  | 'grok';

export type McpClientSetup = {
  id: McpClientId;
  label: string;
  status: 'supported' | 'conditional' | 'unsupported';
  summary: string;
  config: string;
};

const TOKEN_PLACEHOLDER = 'YOUR_VOXEN_MCP_TOKEN';

function setupsEn(endpoint: string): McpClientSetup[] {
  const origin = new URL(endpoint).origin;
  return [
    {
      id: 'codex',
      label: 'Codex',
      status: 'supported',
      summary: 'Set VOXEN_MCP_TOKEN in the environment, then add this to config.toml.',
      config: `[mcp_servers.voxen]\nurl = "${endpoint}"\nbearer_token_env_var = "VOXEN_MCP_TOKEN"\ndefault_tools_approval_mode = "writes"`,
    },
    {
      id: 'claude',
      label: 'Claude Code',
      status: 'supported',
      summary: 'Set VOXEN_MCP_TOKEN in the environment, then add this to .mcp.json.',
      config: `{
  "mcpServers": {
    "voxen": {
      "type": "http",
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer \${VOXEN_MCP_TOKEN}"
      }
    }
  }
}`,
    },
    {
      id: 'openai',
      label: 'OpenAI API',
      status: 'supported',
      summary: 'Build this object on your application server from an environment secret.',
      config: `{
  type: "mcp",
  server_label: "voxen",
  server_url: "${endpoint}",
  headers: {
    Authorization: \`Bearer \${process.env.VOXEN_MCP_TOKEN}\`
  },
  require_approval: "always"
}`,
    },
    {
      id: 'anthropic',
      label: 'Anthropic API',
      status: 'supported',
      summary: 'Build this object inside the server-side mcp_servers array.',
      config: `{
  type: "url",
  url: "${endpoint}",
  name: "voxen",
  authorization_token: process.env.VOXEN_MCP_TOKEN
}`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      status: 'conditional',
      summary:
        'Custom Authorization headers vary by Cursor version. Use a secret header only when your installed version explicitly supports it; otherwise wait for Voxen OAuth.',
      config: `Endpoint: ${endpoint}\nAuthorization: Bearer ${TOKEN_PLACEHOLDER}`,
    },
    {
      id: 'inspector',
      label: 'MCP Inspector',
      status: 'supported',
      summary: 'Select Streamable HTTP and add the Authorization request header.',
      config: `URL: ${endpoint}\nAuthorization: Bearer ${TOKEN_PLACEHOLDER}`,
    },
    {
      id: 'grok',
      label: 'Grok Web',
      status: 'conditional',
      summary:
        'OAuth 2.1 is available when enabled by the admin; public Grok Web validation is still pending. Never use a personal token as OAuth credentials.',
      config: `Server URL: ${endpoint}
Authorization endpoint: ${origin}/api/auth/oauth2/authorize
Token endpoint: ${origin}/api/auth/oauth2/token
Scopes: mcp:read offline_access
Token authentication: none (PKCE S256)
Client secret: leave empty for a registered public client`,
    },
  ];
}

function setupsPtBr(endpoint: string): McpClientSetup[] {
  const setups = setupsEn(endpoint);
  const translated: Record<McpClientId, Pick<McpClientSetup, 'summary' | 'config'>> = {
    codex: {
      summary: 'Defina VOXEN_MCP_TOKEN no ambiente e adicione ao config.toml.',
      config: setups[0]!.config,
    },
    claude: {
      summary: 'HTTP remoto com header Bearer explícito.',
      config: setups[1]!.config,
    },
    openai: {
      summary: 'Mantenha a configuração e o token no servidor da sua aplicação.',
      config: setups[2]!.config,
    },
    anthropic: {
      summary: 'Adicione o objeto ao array mcp_servers no servidor.',
      config: setups[3]!.config,
    },
    cursor: {
      summary:
        'O suporte a header Authorization varia por versão. Use somente quando a sua instalação oferecer header secreto; caso contrário, aguarde o OAuth do Voxen.',
      config: setups[4]!.config,
    },
    inspector: {
      summary: 'Selecione Streamable HTTP e adicione o header Authorization.',
      config: setups[5]!.config,
    },
    grok: {
      summary:
        'OAuth 2.1 está disponível quando o admin habilita; a validação pública no Grok Web ainda está pendente. Nunca use token pessoal como credencial OAuth.',
      config: setups[6]!.config,
    },
  };
  return setups.map((setup) => ({ ...setup, ...translated[setup.id] }));
}

export function mcpClientSetups(locale: Locale, endpoint: string): McpClientSetup[] {
  return locale === 'en' ? setupsEn(endpoint) : setupsPtBr(endpoint);
}

export function mcpTokenPlaceholder(): string {
  return TOKEN_PLACEHOLDER;
}
