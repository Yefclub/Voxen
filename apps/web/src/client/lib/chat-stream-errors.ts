/**
 * Classifica falhas de transporte do stream SSE do chat.
 *
 * Quando o Bun/proxy corta a conexão durante uma tool longa (ex.: transcrição),
 * o browser lança TypeError("Failed to fetch") / "NetworkError" / "Load failed".
 * Isso NÃO significa que o turno morreu — o servidor continua o trabalho durável.
 */

export function isTransientStreamDisconnect(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (error instanceof TypeError) return true;
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('load failed') ||
    msg.includes('connection') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up')
  );
}
