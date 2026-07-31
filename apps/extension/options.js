import { looksLikeVoxenTab, normalizeBaseUrl } from './lib/config.js';
import { ensureHostPermission } from './lib/permissions.js';
import { fetchMe } from './lib/api.js';
import { applyTheme } from './lib/theme.js';

const THEME_CACHE_KEY = 'voxen-ext-theme';

const baseInput = document.getElementById('base-url');
const tokenInput = document.getElementById('api-token');
const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const requestPermBtn = document.getElementById('request-perm');
const detectBtn = document.getElementById('detect');

function setStatus(kind, message) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

async function detectFromTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!looksLikeVoxenTab(tab.url, tab.title)) continue;
    try {
      return new URL(tab.url).origin;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function load() {
  const stored = await chrome.storage.sync.get(['baseUrl', 'apiToken']);
  if (typeof stored.baseUrl === 'string') baseInput.value = stored.baseUrl;
  if (typeof stored.apiToken === 'string') tokenInput.value = stored.apiToken;
}

/**
 * Aplica (e cacheia) o tema da instância assim que a conexão é confirmada —
 * cosmético, nunca bloqueia o fluxo de conexão em si.
 * @param {string} baseUrl
 */
async function syncThemeFromInstance(baseUrl) {
  try {
    const me = await fetchMe(baseUrl);
    if (!me?.theme) return;
    applyTheme(me.theme);
    localStorage.setItem(THEME_CACHE_KEY, me.theme);
  } catch {
    /* tema é cosmético */
  }
}

async function connect(baseUrl) {
  const permitted = await ensureHostPermission(baseUrl);
  await chrome.storage.sync.set({
    baseUrl,
    apiToken: tokenInput.value.trim(),
  });
  baseInput.value = baseUrl;
  if (!permitted) {
    setStatus(
      'err',
      'Salvo, mas a permissão de host foi negada. Sem ela o envio com sessão não funciona.',
    );
    return false;
  }
  setStatus('ok', `Conectado a ${baseUrl}. Pode fechar esta aba e usar o ícone da extensão.`);
  void syncThemeFromInstance(baseUrl);
  return true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const parsed = normalizeBaseUrl(baseInput.value);
  if (!parsed.ok) {
    setStatus('err', parsed.error);
    return;
  }
  await connect(parsed.baseUrl);
});

detectBtn.addEventListener('click', async () => {
  setStatus('', 'Procurando abas do Voxen…');
  const found = await detectFromTabs();
  if (!found) {
    setStatus(
      'warn',
      'Nenhuma aba parece ser o Voxen. Abra a instância (ex.: /extensao) e tente de novo.',
    );
    return;
  }
  await connect(found);
});

requestPermBtn.addEventListener('click', async () => {
  const parsed = normalizeBaseUrl(baseInput.value);
  if (!parsed.ok) {
    setStatus('err', parsed.error);
    return;
  }
  const ok = await ensureHostPermission(parsed.baseUrl);
  setStatus(
    ok ? 'ok' : 'err',
    ok
      ? `Permissão concedida para ${parsed.baseUrl}`
      : 'Permissão negada. O Chromium bloqueia cookies sem o host autorizado.',
  );
});

void load();
