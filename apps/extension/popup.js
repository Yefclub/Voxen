import {
  isSendableTabUrl,
  loginUrl,
  normalizeBaseUrl,
  originPattern,
} from './lib/config.js';
import { submitUrlToVoxen } from './lib/api.js';

const els = {
  setup: document.getElementById('setup-needed'),
  main: document.getElementById('main'),
  title: document.getElementById('tab-title'),
  url: document.getElementById('tab-url'),
  instance: document.getElementById('instance'),
  submit: document.getElementById('submit'),
  status: document.getElementById('status'),
  actions: document.getElementById('actions'),
  openLogin: document.getElementById('open-login'),
  openJob: document.getElementById('open-job'),
  openOptions: document.getElementById('open-options'),
  goOptions: document.getElementById('go-options'),
};

/** @type {{ baseUrl: string, token: string, tabUrl: string, tabTitle: string } | null} */
let state = null;

function setStatus(kind, message) {
  els.status.className = `status ${kind}`;
  els.status.textContent = message;
}

function hideActions() {
  els.actions.classList.add('hidden');
  els.openLogin.classList.add('hidden');
  els.openJob.classList.add('hidden');
}

async function ensureHostPermission(baseUrl) {
  const pattern = originPattern(baseUrl);
  if (!pattern || !chrome.permissions) return true;
  const already = await chrome.permissions.contains({ origins: [pattern] });
  if (already) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function load() {
  const stored = await chrome.storage.sync.get(['baseUrl', 'apiToken']);
  const parsed = normalizeBaseUrl(stored.baseUrl ?? '');

  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.goOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  if (!parsed.ok) {
    els.setup.classList.remove('hidden');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url ?? '';
  const tabTitle = tab?.title || tabUrl || '—';

  state = {
    baseUrl: parsed.baseUrl,
    token: typeof stored.apiToken === 'string' ? stored.apiToken : '',
    tabUrl,
    tabTitle,
  };

  els.main.classList.remove('hidden');
  els.title.textContent = tabTitle;
  els.url.textContent = tabUrl || '—';
  els.instance.textContent = `Instância: ${parsed.baseUrl}`;

  const sendable = isSendableTabUrl(tabUrl);
  els.submit.disabled = !sendable;
  if (!sendable) {
    setStatus('warn', 'Abra uma página http(s) para enviar. chrome:// e extensões não são suportados.');
  }

  els.submit.addEventListener('click', onSubmit);
  els.openLogin.addEventListener('click', () => {
    if (!state) return;
    chrome.tabs.create({ url: loginUrl(state.baseUrl, '/fila') });
  });
  els.openJob.addEventListener('click', () => {
    const jobId = els.openJob.dataset.jobId;
    if (!state || !jobId) return;
    chrome.tabs.create({ url: `${state.baseUrl}/jobs/${encodeURIComponent(jobId)}` });
  });
}

async function onSubmit() {
  if (!state || !isSendableTabUrl(state.tabUrl)) return;
  hideActions();
  els.submit.disabled = true;
  setStatus('', 'Enviando…');

  const permitted = await ensureHostPermission(state.baseUrl);
  if (!permitted) {
    setStatus(
      'err',
      'Permissão de acesso à instância negada. Autorize o host nas configurações ou ao clicar em Enviar.',
    );
    els.submit.disabled = false;
    return;
  }

  const result = await submitUrlToVoxen({
    baseUrl: state.baseUrl,
    pageUrl: state.tabUrl,
    token: state.token || null,
  });

  if (result.ok) {
    const existing = result.status === 'existing' ? ' (já na fila)' : '';
    setStatus('ok', `Enfileirado${existing}.\nJob: ${result.jobId}`);
    els.actions.classList.remove('hidden');
    els.openJob.classList.remove('hidden');
    els.openJob.dataset.jobId = result.jobId;
    els.submit.disabled = false;
    return;
  }

  setStatus('err', result.message);
  els.actions.classList.remove('hidden');
  if (result.code === 'unauthorized') {
    els.openLogin.classList.remove('hidden');
  }
  els.submit.disabled = false;
}

void load();
