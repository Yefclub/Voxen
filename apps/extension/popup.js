import {
  EXTENSION_VERSION,
  isSendableTabUrl,
  jobPageUrl,
  loginUrl,
  normalizeBaseUrl,
  transcriptPageUrl,
} from './lib/config.js';
import { fetchJobStatus, fetchMe, submitUrlToVoxen } from './lib/api.js';
import { ensureHostPermission, hasHostPermission } from './lib/permissions.js';
import { applyTheme } from './lib/theme.js';
import { stageLabel } from './lib/job-stage.js';

const THEME_CACHE_KEY = 'voxen-ext-theme';

const els = {
  setup: document.getElementById('setup-needed'),
  main: document.getElementById('main'),
  title: document.getElementById('tab-title'),
  url: document.getElementById('tab-url'),
  instanceLine: document.getElementById('instance-line'),
  submit: document.getElementById('submit'),
  submitLabel: document.getElementById('submit-label'),
  status: document.getElementById('status'),
  actions: document.getElementById('actions'),
  openLogin: document.getElementById('open-login'),
  openJob: document.getElementById('open-job'),
  openTranscript: document.getElementById('open-transcript'),
  openOptions: document.getElementById('open-options'),
  goOptions: document.getElementById('go-options'),
  progress: document.getElementById('progress'),
  progressFill: document.getElementById('progress-fill'),
  progressLabel: document.getElementById('progress-label'),
  resultCard: document.getElementById('result-card'),
  resultTitle: document.getElementById('result-title'),
  resultSummary: document.getElementById('result-summary'),
  updateBanner: document.getElementById('update-banner'),
  updateText: document.getElementById('update-text'),
  updateOpen: document.getElementById('update-open'),
  versionLabel: document.getElementById('version-label'),
  checkUpdate: document.getElementById('check-update'),
};

/** @type {{ baseUrl: string, token: string, tabUrl: string, tabTitle: string } | null} */
let state = null;
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;

function setStatus(kind, message, target = els.status) {
  target.className = `status ${kind}`;
  target.textContent = message;
}

function hideActions() {
  els.actions.classList.add('hidden');
  els.openLogin.classList.add('hidden');
  els.openJob.classList.add('hidden');
  els.openTranscript.classList.add('hidden');
}

function showProgress(label) {
  els.progress.classList.remove('hidden');
  els.progressFill.className = '';
  els.progressLabel.textContent = label;
}

function endProgress(ok) {
  els.progressFill.className = ok ? 'done' : 'fail';
  els.progressLabel.textContent = ok ? 'Concluído' : 'Falhou';
}

/**
 * Busca o tema da instância conectada (se houver sessão) e aplica. Nunca
 * bloqueia o resto da UI — é cosmético, falha em silêncio.
 * @param {string} baseUrl
 */
async function syncThemeFromInstance(baseUrl) {
  try {
    const permitted = await hasHostPermission(baseUrl);
    if (!permitted) return;
    const me = await fetchMe(baseUrl);
    if (!me?.theme) return;
    applyTheme(me.theme);
    localStorage.setItem(THEME_CACHE_KEY, me.theme);
  } catch {
    /* tema é cosmético — mantém o fallback já aplicado */
  }
}

async function load() {
  els.versionLabel.textContent = `v${EXTENSION_VERSION}`;
  const stored = await chrome.storage.sync.get(['baseUrl', 'apiToken']);
  const parsed = normalizeBaseUrl(stored.baseUrl ?? '');

  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.goOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.checkUpdate.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'check-update' });
  });

  // Soft update banner
  const local = await chrome.storage.local.get(['lastUpdateCheck']);
  if (local.lastUpdateCheck?.hasUpdate) {
    els.updateBanner.classList.remove('hidden');
    els.updateText.textContent = `v${local.lastUpdateCheck.remoteVersion} disponível`;
    els.updateOpen.onclick = () => {
      const url = local.lastUpdateCheck.pageUrl;
      if (url) chrome.tabs.create({ url });
    };
  }

  if (!parsed.ok) {
    els.setup.classList.remove('hidden');
    return;
  }

  void syncThemeFromInstance(parsed.baseUrl);

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
  try {
    els.instanceLine.textContent = new URL(parsed.baseUrl).host;
  } catch {
    els.instanceLine.textContent = parsed.baseUrl;
  }

  const sendable = isSendableTabUrl(tabUrl);
  els.submit.disabled = !sendable;
  if (!sendable) {
    setStatus('warn', 'Abra uma página http(s). chrome:// e extensões não são suportados.');
  }

  els.submit.addEventListener('click', onSubmit);
  els.openLogin.addEventListener('click', () => {
    if (!state) return;
    chrome.tabs.create({ url: loginUrl(state.baseUrl, '/fila') });
  });
  els.openJob.addEventListener('click', () => {
    const jobId = els.openJob.dataset.jobId;
    if (!state || !jobId) return;
    chrome.tabs.create({ url: jobPageUrl(state.baseUrl, jobId) });
  });
  els.openTranscript.addEventListener('click', () => {
    const tid = els.openTranscript.dataset.transcriptId;
    if (!state || !tid) return;
    chrome.tabs.create({ url: transcriptPageUrl(state.baseUrl, tid) });
  });
}

async function onSubmit() {
  if (!state || !isSendableTabUrl(state.tabUrl)) return;
  hideActions();
  els.resultCard.classList.add('hidden');
  els.submit.disabled = true;
  els.submitLabel.textContent = 'Enviando…';
  setStatus('', '');
  showProgress('Enfileirando…');

  const permitted = await ensureHostPermission(state.baseUrl);
  if (!permitted) {
    endProgress(false);
    setStatus('err', 'Permissão de acesso à instância negada. Autorize o host para continuar.');
    els.submit.disabled = false;
    els.submitLabel.textContent = 'Salvar no Voxen';
    return;
  }

  const result = await submitUrlToVoxen({
    baseUrl: state.baseUrl,
    pageUrl: state.tabUrl,
    token: state.token || null,
  });

  if (!result.ok) {
    endProgress(false);
    setStatus('err', result.message);
    els.actions.classList.remove('hidden');
    if (result.code === 'unauthorized') els.openLogin.classList.remove('hidden');
    els.submit.disabled = false;
    els.submitLabel.textContent = 'Salvar no Voxen';
    return;
  }

  const existing = result.status === 'existing' ? ' (já na fila)' : '';
  setStatus('ok', `Na fila${existing}. Acompanhe aqui — avisamos quando ficar pronto.`);
  els.actions.classList.remove('hidden');
  els.openJob.classList.remove('hidden');
  els.openJob.dataset.jobId = result.jobId;
  els.submitLabel.textContent = 'Salvo — processando';
  showProgress(stageLabel('queued'));

  // Background tracking (notificações mesmo com popup fechado)
  chrome.runtime.sendMessage({
    type: 'track-job',
    payload: {
      jobId: result.jobId,
      baseUrl: state.baseUrl,
      token: state.token || '',
      pageTitle: state.tabTitle,
    },
  });

  // Poll no popup enquanto aberto
  startPopupPoll(result.jobId);
}

/**
 * @param {string} jobId
 */
function startPopupPoll(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  let ticks = 0;
  pollTimer = setInterval(async () => {
    if (!state) return;
    ticks += 1;
    if (ticks > 120) {
      // ~4 min
      clearInterval(pollTimer);
      pollTimer = null;
      els.progressLabel.textContent = 'Ainda processando — avisaremos por notificação.';
      els.submit.disabled = false;
      els.submitLabel.textContent = 'Salvar outro';
      return;
    }
    const r = await fetchJobStatus({
      baseUrl: state.baseUrl,
      jobId,
      token: state.token || null,
    });
    if (!r.ok) return;
    const st = r.job.status;
    if (st === 'RUNNING' || st === 'QUEUED') {
      els.progressLabel.textContent = stageLabel(
        r.job.progressStage || st.toLowerCase(),
        r.job.type,
      );
      return;
    }
    clearInterval(pollTimer);
    pollTimer = null;
    if (st === 'SUCCEEDED' || st === 'DONE' || st === 'COMPLETED') {
      endProgress(true);
      setStatus('ok', 'Pronto!');
      els.resultCard.classList.remove('hidden');
      els.resultTitle.textContent = r.job.title || state.tabTitle;
      els.resultSummary.textContent =
        r.job.summary || 'Conteúdo disponível na sua base. Abra para ler.';
      if (r.job.transcriptId) {
        els.openTranscript.classList.remove('hidden');
        els.openTranscript.dataset.transcriptId = r.job.transcriptId;
      }
      els.submit.disabled = false;
      els.submitLabel.textContent = 'Salvar outro';
      return;
    }
    if (st === 'FAILED' || st === 'CANCELLED') {
      endProgress(false);
      setStatus('err', r.job.errorMsg || 'O processamento falhou.');
      els.submit.disabled = false;
      els.submitLabel.textContent = 'Tentar de novo';
    }
  }, 2000);
}

void load();
