const LOCAL_STREAM_EVENTS = new Set(['start', 'start-step', 'abort']);

/**
 * `fullStream` começa com eventos de orquestração criados pelo AI SDK antes de
 * qualquer resposta do provedor. A latência percebida só termina no primeiro
 * evento que atravessou essa fronteira.
 */
export function isProviderObservedEvent(type: unknown): boolean {
  return typeof type === 'string' && !LOCAL_STREAM_EVENTS.has(type);
}
