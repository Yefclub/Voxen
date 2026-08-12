/**
 * Regras puras de segmentação do stream do turno.
 *
 * Vivem fora do `runtime.ts` porque a sequência que elas governam — raciocínio,
 * texto final, raciocínio de novo — só é verificável olhando a lista inteira de
 * segmentos, e isso exige um teste que não suba o runtime.
 */

/**
 * O `fullStream` do AI SDK entrega `text-delta` de texto VAZIO desde a 7.0.42,
 * quando o chunk carrega `providerMetadata` — e modelo de raciocínio via
 * `providerOptions.openrouter.reasoning` produz exatamente esse formato. Até a
 * 7.0.22 o SDK filtrava esses chunks, então `typeof text === 'string'` bastava.
 *
 * Não basta mais: delta vazio não é começo de resposta, mas fechava o segmento
 * de raciocínio corrente. O `reasoning-delta` seguinte encontrava o segmento
 * fechado e abria outro, partindo um raciocínio contínuo em dois blocos na UI e
 * no que é persistido.
 */
export function isFinalTextDelta(part: {
  type?: unknown;
  text?: unknown;
}): part is { type: 'text-delta'; text: string } {
  return part.type === 'text-delta' && typeof part.text === 'string' && part.text.length > 0;
}
