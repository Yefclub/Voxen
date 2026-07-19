/**
 * Service worker MV3 — abre options no first-run se base URL não configurada.
 */

import { normalizeBaseUrl } from './lib/config.js';

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  const stored = await chrome.storage.sync.get(['baseUrl']);
  const parsed = normalizeBaseUrl(stored.baseUrl ?? '');
  if (!parsed.ok) {
    chrome.runtime.openOptionsPage();
  }
});
