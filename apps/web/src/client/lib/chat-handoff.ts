/**
 * Handoff de outras páginas (ex.: detalhe de transcrição) → chat single-session.
 * O ChatPage lê `location.state.autoSend` e dispara o stream uma vez.
 */
export type ChatHandoffState = {
  /** Mensagem a enviar automaticamente ao montar o chat. */
  autoSend?: string;
};

export function buildTranscriptChatMessage(options: {
  userText: string;
  transcriptId: string;
  title: string;
}): string {
  const text = options.userText.trim();
  const title = options.title.trim() || options.transcriptId;
  return [
    `Sobre o conteúdo "${title}" da minha biblioteca (transcriptId=${options.transcriptId}):`,
    '',
    text,
  ].join('\n');
}
