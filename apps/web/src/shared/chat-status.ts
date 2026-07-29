export type ChatStatusCode = 'preparing-response' | 'connecting-model';

const CHAT_STATUS_I18N_KEYS = {
  'preparing-response': 'chat.status.preparingResponse',
  'connecting-model': 'chat.status.connectingModel',
} as const;

export function chatStatusI18nKey(
  code: ChatStatusCode | undefined,
): (typeof CHAT_STATUS_I18N_KEYS)[ChatStatusCode] | null {
  return code ? CHAT_STATUS_I18N_KEYS[code] : null;
}
