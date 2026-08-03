import { looksLikeVoxenTab, normalizeBaseUrl } from './lib/config.js';
import {
  ensureHostPermission,
  ensurePlatformCookieAccess,
  hasHostPermission,
  revokePlatformCookieAccess,
} from './lib/permissions.js';
import {
  deletePlatformCookies,
  fetchMe,
  fetchPlatformCookieStatus,
  sendPlatformCookies,
} from './lib/api.js';
import { PLATFORMS, filterPlatformCookies, hasSessionCookie, toNetscape } from './lib/platforms.js';

// theme-init.js roda como script clássico no <head> (CSP do MV3 bloqueia
// inline) e publica os helpers de tema em globalThis — ver comentário lá.
const { applyTheme, cacheTheme } = globalThis.VoxenTheme;

const baseInput = document.getElementById('base-url');
const tokenInput = document.getElementById('api-token');
const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const requestPermBtn = document.getElementById('request-perm');
const detectBtn = document.getElementById('detect');
const accountsSection = document.getElementById('accounts');
const platformList = document.getElementById('platform-list');
const accountsStatusEl = document.getElementById('accounts-status');

function setStatus(kind, message) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

function setAccountsStatus(kind, message) {
  accountsStatusEl.className = `status ${kind}`;
  accountsStatusEl.textContent = message;
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

  // Perfil já conectado: aplica o tema da instância também ao abrir a página,
  // não só depois de clicar em conectar.
  const parsed = normalizeBaseUrl(stored.baseUrl ?? '');
  if (parsed.ok) {
    void syncThemeFromInstance(parsed.baseUrl);
    void refreshAccounts(parsed.baseUrl);
  }
}

/**
 * Aplica (e cacheia) o tema da instância — cosmético, nunca bloqueia o fluxo
 * de conexão em si. Sem host permission a chamada nem é tentada (o Chromium
 * bloquearia o cookie de sessão e o /api/me voltaria 401).
 * @param {string} baseUrl
 */
async function syncThemeFromInstance(baseUrl) {
  try {
    const permitted = await hasHostPermission(baseUrl);
    if (!permitted) return;
    const me = await fetchMe(baseUrl);
    if (!me?.theme) return;
    applyTheme(me.theme);
    cacheTheme(me.theme);
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
  void refreshAccounts(baseUrl);
  return true;
}

// ---------------------------------------------------------------------------
// Contas de plataforma (spec 152)
// ---------------------------------------------------------------------------
// A seção só aparece quando existe uma sessão Voxen válida. A conta de cada
// plataforma pertence ao usuário da sessão, não ao administrador da instância.
//
// O valor do cookie nunca é exibido, guardado em `chrome.storage` nem logado:
// ele existe só como variável local entre o `chrome.cookies.getAll` e o PATCH.

/** @type {string | null} baseUrl da instância cuja seção está renderizada. */
let accountsBaseUrl = null;

function hideAccounts() {
  accountsBaseUrl = null;
  accountsSection.hidden = true;
  platformList.replaceChildren();
  setAccountsStatus('', '');
}

/**
 * Consulta o estado por plataforma e (re)desenha a seção. Silenciosa quando o
 * usuário não está logado: a seção simplesmente não aparece.
 * @param {string} baseUrl
 */
async function refreshAccounts(baseUrl) {
  const permitted = await hasHostPermission(baseUrl);
  if (!permitted) {
    hideAccounts();
    return;
  }

  const me = await fetchMe(baseUrl);
  if (!me) {
    hideAccounts();
    return;
  }

  const res = await fetchPlatformCookieStatus({ baseUrl });
  if (!res.ok) {
    hideAccounts();
    return;
  }

  accountsBaseUrl = baseUrl;
  accountsSection.hidden = false;
  renderPlatforms(res.platforms);
}

/**
 * @param {Array<{ platform: string, hasCookie: boolean, capturedAt: string | null, stale: boolean }>} statuses
 */
function renderPlatforms(statuses) {
  const byId = new Map(statuses.map((s) => [s.platform, s]));
  platformList.replaceChildren(
    ...PLATFORMS.map((platform) => renderPlatformRow(platform, byId.get(platform.id) ?? null)),
  );
}

/**
 * @param {string | null} capturedAt
 */
function formatCapturedAt(capturedAt) {
  if (!capturedAt) return null;
  const ts = Date.parse(capturedAt);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toLocaleDateString();
}

/**
 * Linha de uma plataforma. Tudo montado via DOM API (nada de innerHTML).
 * @param {import('./lib/platforms.js').Platform} platform
 * @param {{ hasCookie: boolean, capturedAt: string | null, stale: boolean } | null} status
 */
function renderPlatformRow(platform, status) {
  const li = document.createElement('li');
  li.className = 'platform';

  const info = document.createElement('div');
  info.className = 'platform-info';
  const name = document.createElement('span');
  name.className = 'platform-name';
  name.textContent = platform.label;
  const state = document.createElement('span');
  state.className = 'platform-state';

  const captured = formatCapturedAt(status?.capturedAt ?? null);
  if (!status?.hasCookie) {
    state.textContent = 'Não conectado';
  } else if (status.stale) {
    state.className = 'platform-state warn';
    state.textContent = captured
      ? `Possivelmente expirado — conectado em ${captured}`
      : 'Possivelmente expirado';
  } else {
    state.className = 'platform-state ok';
    state.textContent = captured ? `Conectado em ${captured}` : 'Conectado';
  }
  info.append(name, state);

  const actions = document.createElement('div');
  actions.className = 'platform-actions';

  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.className = 'btn primary';
  connectBtn.textContent = status?.hasCookie ? 'Reconectar' : 'Conectar';
  connectBtn.addEventListener('click', () => void connectPlatform(platform, connectBtn));
  actions.append(connectBtn);

  if (status?.hasCookie) {
    const disconnectBtn = document.createElement('button');
    disconnectBtn.type = 'button';
    disconnectBtn.className = 'btn ghost';
    disconnectBtn.textContent = 'Desconectar';
    disconnectBtn.addEventListener('click', () => void disconnectPlatform(platform, disconnectBtn));
    actions.append(disconnectBtn);
  }

  li.append(info, actions);
  return li;
}

/**
 * Captura e envia. Falha em qualquer etapa NÃO apaga o que já está no backend
 * — o fluxo só grava via PATCH bem-sucedido.
 * @param {import('./lib/platforms.js').Platform} platform
 * @param {HTMLButtonElement} button
 */
async function connectPlatform(platform, button) {
  if (!accountsBaseUrl) return;
  button.disabled = true;
  setAccountsStatus('', `Conectando ${platform.label}…`);
  try {
    // Precisa rodar dentro do clique: o Chromium exige gesto do usuário.
    const granted = await ensurePlatformCookieAccess(platform);
    if (!granted) {
      setAccountsStatus(
        'err',
        `Permissão negada para ${platform.label}. Sem ela não dá para ler a sessão do site.`,
      );
      return;
    }

    // A permissão `cookies` é opcional: a API normalmente já fica disponível
    // logo após a concessão, mas se o binding ainda não existir neste contexto
    // é melhor pedir um reload do que estourar um TypeError silencioso.
    if (!chrome.cookies?.getAll) {
      setAccountsStatus('warn', 'Permissão concedida. Recarregue esta página e clique de novo.');
      return;
    }

    const all = await chrome.cookies.getAll({ domain: platform.cookieDomain });
    const relevant = filterPlatformCookies(all, platform);
    if (!hasSessionCookie(relevant, platform)) {
      setAccountsStatus(
        'warn',
        `Nenhuma sessão do ${platform.label} encontrada. Faça login no site neste mesmo perfil do browser e tente de novo.`,
      );
      return;
    }

    const cookies = toNetscape(relevant);
    if (!cookies) {
      setAccountsStatus('warn', `Nenhum cookie válido do ${platform.label} para enviar.`);
      return;
    }

    const res = await sendPlatformCookies({
      baseUrl: accountsBaseUrl,
      platform: platform.id,
      cookies,
    });
    if (!res.ok) {
      setAccountsStatus('err', res.message);
      return;
    }
    setAccountsStatus('ok', `${platform.label} conectado.`);
  } catch {
    // Nunca propagar o erro cru: ele pode carregar pedaço do payload.
    setAccountsStatus('err', `Não foi possível conectar ${platform.label}.`);
  } finally {
    button.disabled = false;
    await refreshAccounts(accountsBaseUrl);
  }
}

/**
 * @param {import('./lib/platforms.js').Platform} platform
 * @param {HTMLButtonElement} button
 */
async function disconnectPlatform(platform, button) {
  if (!accountsBaseUrl) return;
  button.disabled = true;
  try {
    const res = await deletePlatformCookies({
      baseUrl: accountsBaseUrl,
      platform: platform.id,
    });
    if (!res.ok) {
      setAccountsStatus('err', res.message);
      return;
    }
    // Removeu do backend: a extensão também devolve a permissão daquele site.
    await revokePlatformCookieAccess(platform);
    setAccountsStatus('ok', `${platform.label} desconectado.`);
  } catch {
    setAccountsStatus('err', `Não foi possível desconectar ${platform.label}.`);
  } finally {
    button.disabled = false;
    await refreshAccounts(accountsBaseUrl);
  }
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
