import { normalizeBaseUrl, originPattern } from './lib/config.js';

const baseInput = document.getElementById('base-url');
const tokenInput = document.getElementById('api-token');
const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const requestPermBtn = document.getElementById('request-perm');

function setStatus(kind, message) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

async function requestHostPermission(baseUrl) {
  const pattern = originPattern(baseUrl);
  if (!pattern) return false;
  if (!chrome.permissions) return true;
  const already = await chrome.permissions.contains({ origins: [pattern] });
  if (already) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function load() {
  const stored = await chrome.storage.sync.get(['baseUrl', 'apiToken']);
  if (typeof stored.baseUrl === 'string') baseInput.value = stored.baseUrl;
  if (typeof stored.apiToken === 'string') tokenInput.value = stored.apiToken;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const parsed = normalizeBaseUrl(baseInput.value);
  if (!parsed.ok) {
    setStatus('err', parsed.error);
    return;
  }

  const permitted = await requestHostPermission(parsed.baseUrl);
  await chrome.storage.sync.set({
    baseUrl: parsed.baseUrl,
    apiToken: tokenInput.value.trim(),
  });
  baseInput.value = parsed.baseUrl;

  if (!permitted) {
    setStatus(
      'err',
      'Salvo, mas a permissão de host foi negada. O envio só funciona após autorizar o host.',
    );
    return;
  }
  setStatus('ok', `Salvo. Instância: ${parsed.baseUrl}`);
});

requestPermBtn.addEventListener('click', async () => {
  const parsed = normalizeBaseUrl(baseInput.value);
  if (!parsed.ok) {
    setStatus('err', parsed.error);
    return;
  }
  const ok = await requestHostPermission(parsed.baseUrl);
  setStatus(
    ok ? 'ok' : 'err',
    ok
      ? `Permissão concedida para ${parsed.baseUrl}`
      : 'Permissão negada. Sem ela o Chromium bloqueia o fetch com cookies.',
  );
});

void load();
