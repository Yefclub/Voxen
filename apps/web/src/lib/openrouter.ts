// ============================================================================
// OpenRouter client — validação de API key + listagem de modelos
// ============================================================================
// Usado no fluxo de setup inicial (admin cola key → valida → persiste cifrado).
// Para testes, injeta-se um `fetcher` custom; em prod usa `globalThis.fetch`.
// ============================================================================

export type Fetcher = typeof globalThis.fetch;

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OrModel {
  id: string;
  name: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  pricing?: Record<string, string>;
}

export class OpenrouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenrouterError';
  }
}

/**
 * Valida uma API key chamando GET /api/v1/key. Retorna true se a chave for
 * aceita (HTTP 200), false se for rejeitada (401/403). Joga `OpenrouterError`
 * em qualquer outro caso (rede, 5xx, etc.) — não engole erros operacionais.
 */
export async function validateApiKey(key: string, fetcher: Fetcher = fetch): Promise<boolean> {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return false;
  }
  let res: Response;
  try {
    res = await fetcher(`${OR_BASE_URL}/key`, {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (err) {
    throw new OpenrouterError(
      `Falha ao contatar OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 200) return true;
  if (res.status === 401 || res.status === 403) return false;
  throw new OpenrouterError(`OpenRouter retornou status ${res.status}`, res.status);
}

/**
 * Lista modelos da OpenRouter filtrados por `outputModality`.
 * `text` → modelos de chat; `transcription` → modelos de áudio→texto.
 * Erros de rede/HTTP viram `OpenrouterError`.
 */
export async function listModels(
  key: string,
  outputModality: 'text' | 'transcription',
  fetcher: Fetcher = fetch,
): Promise<OrModel[]> {
  let res: Response;
  try {
    res = await fetcher(`${OR_BASE_URL}/models?output_modalities=${outputModality}`, {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (err) {
    throw new OpenrouterError(
      `Falha ao contatar OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new OpenrouterError(`OpenRouter retornou status ${res.status}`, res.status);
  }
  const body = (await res.json()) as { data?: OrModel[] };
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * Lista modelos multimodais (aceitam imagem como entrada). Usado na análise
 * de imagens enviadas como mídia. Filtra `input_modalities=image,text` direto
 * na OR.
 */
export async function listVisionModels(key: string, fetcher: Fetcher = fetch): Promise<OrModel[]> {
  let res: Response;
  try {
    res = await fetcher(`${OR_BASE_URL}/models?input_modalities=image,text`, {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (err) {
    throw new OpenrouterError(
      `Falha ao contatar OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new OpenrouterError(`OpenRouter retornou status ${res.status}`, res.status);
  }
  const body = (await res.json()) as { data?: OrModel[] };
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * Lista modelos que aceitam entrada nativa de arquivo/PDF. OpenRouter expõe
 * isso em `architecture.input_modalities`; mantemos filtro local porque nem
 * todos os filtros de query são documentados para input modality.
 */
export async function listDocumentModels(
  key: string,
  fetcher: Fetcher = fetch,
): Promise<OrModel[]> {
  let res: Response;
  try {
    res = await fetcher(`${OR_BASE_URL}/models?output_modalities=text`, {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (err) {
    throw new OpenrouterError(
      `Falha ao contatar OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new OpenrouterError(`OpenRouter retornou status ${res.status}`, res.status);
  }
  const body = (await res.json()) as { data?: OrModel[] };
  const data = Array.isArray(body.data) ? body.data : [];
  return data.filter((m) => {
    const inputs = m.architecture?.input_modalities ?? [];
    const outputs = m.architecture?.output_modalities ?? [];
    return inputs.includes('file') && (outputs.length === 0 || outputs.includes('text'));
  });
}

/**
 * Lista modelos xAI/Grok que podem usar busca nativa no X via OpenRouter.
 * A análise de X depende do `plugins: [{ id: "web", engine: "native" }]`
 * e da camada x_search nativa exposta pelos modelos Grok.
 */
export async function listXAnalysisModels(
  key: string,
  fetcher: Fetcher = fetch,
): Promise<OrModel[]> {
  const models = await listModels(key, 'text', fetcher);
  return models
    .filter((m) => {
      const id = m.id.toLowerCase();
      const name = (m.name ?? '').toLowerCase();
      const outputs = m.architecture?.output_modalities ?? [];
      const textOutput = outputs.length === 0 || outputs.includes('text');
      return textOutput && (id.startsWith('x-ai/grok') || name.includes('grok'));
    })
    .sort((a, b) => {
      const aId = a.id.toLowerCase();
      const bId = b.id.toLowerCase();
      const aFast = aId.includes('fast') ? 0 : 1;
      const bFast = bId.includes('fast') ? 0 : 1;
      if (aFast !== bFast) return aFast - bFast;
      return a.id.localeCompare(b.id);
    });
}
