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

function setupsEn(endpoint: string, token: string): McpClientSetup[] {
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
      summary: 'Remote HTTP with an explicit Bearer header.',
      config: `claude mcp add --scope user --transport http voxen ${endpoint} --header "Authorization: Bearer ${token}"`,
    },
    {
      id: 'openai',
      label: 'OpenAI API',
      status: 'supported',
      summary: 'Keep this configuration and token on your application server.',
      config: JSON.stringify(
        {
          type: 'mcp',
          server_label: 'voxen',
          server_url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
          require_approval: 'always',
        },
        null,
        2,
      ),
    },
    {
      id: 'anthropic',
      label: 'Anthropic API',
      status: 'supported',
      summary: 'Add this object to the server-side mcp_servers array.',
      config: JSON.stringify(
        { type: 'url', url: endpoint, name: 'voxen', authorization_token: token },
        null,
        2,
      ),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      status: 'conditional',
      summary:
        'Custom Authorization headers vary by Cursor version. Use a secret header only when your installed version explicitly supports it; otherwise wait for Voxen OAuth.',
      config: `Endpoint: ${endpoint}\nAuthorization: Bearer ${token}`,
    },
    {
      id: 'inspector',
      label: 'MCP Inspector',
      status: 'supported',
      summary: 'Select Streamable HTTP and add the Authorization request header.',
      config: `URL: ${endpoint}\nAuthorization: Bearer ${token}`,
    },
    {
      id: 'grok',
      label: 'Grok Web',
      status: 'unsupported',
      summary:
        'Not supported yet: Grok Web requires OAuth. A personal Voxen token is not an OAuth client ID or client secret.',
      config: 'Do not paste a Voxen personal token into the Grok OAuth form.',
    },
  ];
}

function setupsPtBr(endpoint: string, token: string): McpClientSetup[] {
  const setups = setupsEn(endpoint, token);
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
        'Ainda não suportado: o Grok Web exige OAuth. Token pessoal não é client ID nem client secret.',
      config: 'Não cole um token pessoal do Voxen no formulário OAuth do Grok.',
    },
  };
  return setups.map((setup) => ({ ...setup, ...translated[setup.id] }));
}

export function mcpClientSetups(
  locale: Locale,
  endpoint: string,
  visibleToken: string | null,
): McpClientSetup[] {
  const token = visibleToken || TOKEN_PLACEHOLDER;
  return locale === 'en' ? setupsEn(endpoint, token) : setupsPtBr(endpoint, token);
}

export function mcpTokenPlaceholder(): string {
  return TOKEN_PLACEHOLDER;
}
