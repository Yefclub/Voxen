import { z } from 'zod';
import { getUserSetting, setUserSetting } from '../settings';

export const AssistantPreferencesSchema = z.object({
  role: z.enum(['standard', 'fast']).default('standard'),
  webEnabled: z.boolean().default(false),
});
export async function getAssistantPreferences(userId: string) {
  const raw = await getUserSetting(userId, 'assistant_preferences');
  try {
    return AssistantPreferencesSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return AssistantPreferencesSchema.parse({});
  }
}
export async function saveAssistantPreferences(userId: string, value: unknown) {
  const preferences = AssistantPreferencesSchema.parse(value);
  await setUserSetting(userId, 'assistant_preferences', JSON.stringify(preferences));
  return preferences;
}
