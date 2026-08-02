/**
 * Persistência USER-scoped de always-allow HITL.
 */

import { getUserSetting, setUserSetting } from '../settings';
import {
  HITL_ALWAYS_ALLOW_SETTING_KEY,
  parseAlwaysAllowActions,
  serializeAlwaysAllowActions,
  withAlwaysAllowAction,
  type HitlWriteAction,
} from './hitl-policy';

export async function loadAlwaysAllowActions(userId: string): Promise<Set<HitlWriteAction>> {
  const raw = await getUserSetting(userId, HITL_ALWAYS_ALLOW_SETTING_KEY).catch(() => null);
  return parseAlwaysAllowActions(raw);
}

export async function grantAlwaysAllowAction(
  userId: string,
  action: string,
): Promise<Set<HitlWriteAction>> {
  const current = await loadAlwaysAllowActions(userId);
  const next = withAlwaysAllowAction(current, action);
  await setUserSetting(userId, HITL_ALWAYS_ALLOW_SETTING_KEY, serializeAlwaysAllowActions(next));
  return next;
}
