// ============================================================================
// OpenRouter client — validação de API key + catálogo autorizado da conta
// ============================================================================
// Usado no fluxo de setup inicial (admin cola key → valida → persiste cifrado).
// Para testes, injeta-se um `fetcher` custom; em prod usa `globalThis.fetch`.
// ============================================================================

type Fetcher = typeof globalThis.fetch;

const OR_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_SETUP_TIMEOUT_MS = 15_000;

export type OpenRouterProbePurpose =
  | 'chat'
  | 'transcription'
  | 'webSearch'
  | 'vision'
  | 'document'
  | 'xAnalysis'
  | 'embeddings';

export interface OrModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string>;
}

export class OpenrouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenrouterError';
  }
}

/** Gera um embedding de consulta sem expor a chave nem detalhes do provedor. */
export async function createEmbedding(
  key: string,
  model: string,
  input: string,
  fetcher: Fetcher = fetch,
): Promise<number[]> {
  const clean = input.trim().replace(/\0/g, ' ').slice(0, 8_000);
  if (!key.trim() || !model.trim() || clean.length < 2) return [];
  let response: Response;
  try {
    response = await fetcher(`${OR_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, input: clean }),
      signal: openrouterRequestSignal(),
    });
  } catch (error) {
    throw openrouterNetworkError(error);
  }
  if (!response.ok) throw new OpenrouterError(`OpenRouter retornou status ${response.status}`);
  let body: { data?: Array<{ embedding?: unknown }> };
  try {
    body = (await response.json()) as { data?: Array<{ embedding?: unknown }> };
  } catch {
    throw new OpenrouterError('OpenRouter retornou um embedding inválido.');
  }
  const embedding = body.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length < 8) {
    throw new OpenrouterError('OpenRouter retornou um embedding inválido.');
  }
  const vector = embedding.map((value) => Number(value));
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new OpenrouterError('OpenRouter retornou um embedding inválido.');
  }
  return vector;
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

/**
 * Executa uma chamada mínima no provedor para verificar uma capacidade sem
 * criar conteúdo no Voxen. A cobrança eventual é a da própria OpenRouter;
 * nenhum CostEvent, nota, transcrição ou job é persistido localmente.
 */
export async function probeOpenRouterCapability(
  key: string,
  model: string,
  purpose: OpenRouterProbePurpose,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const isEmbedding = purpose === 'embeddings';
  const isTranscription = purpose === 'transcription';
  const url = isEmbedding
    ? `${OR_BASE_URL}/embeddings`
    : isTranscription
      ? `${OR_BASE_URL}/audio/transcriptions`
      : `${OR_BASE_URL}/chat/completions`;
  let body: BodyInit;
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };

  if (isEmbedding) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ model, input: 'Voxen health check' });
  } else if (isTranscription) {
    const form = new FormData();
    // WAV PCM válido e silencioso; é descartado após a requisição.
    const wav = Uint8Array.from(
      atob('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='),
      (byte) => byte.charCodeAt(0),
    );
    form.set('file', new Blob([wav], { type: 'audio/wav' }), 'health-check.wav');
    form.set('model', model);
    body = form;
  } else {
    headers['content-type'] = 'application/json';
    const content =
      purpose === 'vision'
        ? [
            { type: 'text', text: 'Responda somente OK.' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2RwAAAABJRU5ErkJggg==',
              },
            },
          ]
        : purpose === 'document'
          ? [
              { type: 'text', text: 'Leia o arquivo e responda somente OK.' },
              {
                type: 'file',
                file: {
                  filename: 'health-check.txt',
                  file_data: 'data:text/plain;base64,Vm94ZW4gaGVhbHRoIGNoZWNr',
                },
              },
            ]
          : 'Responda somente OK.';
    body = JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 2,
      ...(purpose === 'webSearch' || purpose === 'xAnalysis'
        ? {
            tools: [
              {
                type: 'openrouter:web_search',
                parameters: { engine: 'auto', max_results: 1 },
              },
            ],
          }
        : {}),
    });
  }

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(OPENROUTER_SETUP_TIMEOUT_MS),
    });
  } catch (error) {
    throw openrouterNetworkError(error);
  }
  if (!response.ok) throw new OpenrouterError(`OpenRouter retornou status ${response.status}`);
}
