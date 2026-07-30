// ============================================================================
// OpenRouter client — validação de API key + catálogo autorizado da conta
// ============================================================================
// Usado no fluxo de setup inicial (admin cola key → valida → persiste cifrado).
// Para testes, injeta-se um `fetcher` custom; em prod usa `globalThis.fetch`.
// ============================================================================

type Fetcher = typeof globalThis.fetch;

const OR_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_SETUP_TIMEOUT_MS = 15_000;

interface OrModel {
  id: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

export class OpenrouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenrouterError';
  }
}

function openrouterRequestSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? AbortSignal.timeout(OPENROUTER_SETUP_TIMEOUT_MS);
}

function openrouterNetworkError(err: unknown): OpenrouterError {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name?: unknown }).name)
      : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new OpenrouterError(
      'A OpenRouter não respondeu em 15 segundos. Verifique a conexão e tente novamente.',
    );
  }
  return new OpenrouterError(
    'Não foi possível contatar a OpenRouter. Verifique a conexão e tente novamente.',
  );
}

/**
 * Valida uma API key chamando GET /api/v1/key. Retorna true se a chave for
 * aceita (HTTP 200), false se for rejeitada (401/403). Joga `OpenrouterError`
 * em qualquer outro caso (rede, 5xx, etc.) — não engole erros operacionais.
 */
export async function validateApiKey(
  key: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<boolean> {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return false;
  }
  let res: Response;
  try {
    res = await fetcher(`${OR_BASE_URL}/key`, {
      headers: { authorization: `Bearer ${key}` },
      signal: openrouterRequestSignal(signal),
    });
  } catch (err) {
    throw openrouterNetworkError(err);
  }
  if (res.status === 200) return true;
  if (res.status === 401 || res.status === 403) return false;
  throw new OpenrouterError(`OpenRouter retornou status ${res.status}`);
}

/**
 * Lista somente modelos roteáveis para a chave, já considerando preferências
 * de provedores, privacidade e guardrails da conta.
 */
export async function listUserModels(
  key: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<OrModel[]> {
  let res: Response;
  try {
    res = await fetcher(`${OR_BASE_URL}/models/user`, {
      headers: { authorization: `Bearer ${key}` },
      signal: openrouterRequestSignal(signal),
    });
  } catch (err) {
    throw openrouterNetworkError(err);
  }
  if (!res.ok) {
    throw new OpenrouterError(`OpenRouter retornou status ${res.status}`);
  }
  let body: { data?: OrModel[] };
  try {
    body = (await res.json()) as { data?: OrModel[] };
  } catch (err) {
    throw openrouterNetworkError(err);
  }
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * Valida a chave e o catálogo dentro de um único prazo total. As duas
 * requisições compartilham o mesmo signal, portanto a segunda recebe apenas o
 * tempo restante dos quinze segundos — não um novo prazo completo.
 */
export async function inspectOpenRouterAccount(
  key: string,
  fetcher: Fetcher = fetch,
  timeoutMs = OPENROUTER_SETUP_TIMEOUT_MS,
): Promise<{ valid: boolean; models: OrModel[] }> {
  const signal = AbortSignal.timeout(timeoutMs);
  const valid = await validateApiKey(key, fetcher, signal);
  if (!valid) return { valid: false, models: [] };
  const models = await listUserModels(key, fetcher, signal);
  return { valid: true, models };
}
