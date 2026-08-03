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
import { stageLabel } from './lib/job-stage.js';
import {
  LAST_OUTCOME_KEY,
  TRACKED_JOBS_KEY,
  buildJobOutcome,
  classifyJobStatus,
  selectPopupState,
  submitButtonState,
} from './lib/job-state.js';

// theme-init.js roda como script clássico no <head> (CSP do MV3 bloqueia
// inline) e publica os helpers de tema em globalThis — ver comentário lá.
const { applyTheme, cacheTheme } = globalThis.VoxenTheme;

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
/**
 * Job que este popup está acompanhando agora. Vem do envio atual ou do
 * rastreamento persistido pelo service worker (`lib/job-state.js`).
 * @type {{ jobId: string, baseUrl: string, token: string, pageTitle: string } | null}
 */
let tracking = null;
let pollTicks = 0;

function setStatus(kind, message, target = els.status) {
  target.className = `status ${kind}`;
  target.textContent = message;
}

/**
 * Único ponto que mexe no botão de envio. A decisão em si é pura e vive em
 * `lib/job-state.js` — aqui só se aplica o resultado ao DOM.
 * @param {'idle' | 'sending' | 'tracking' | 'unavailable' | 'succeeded' | 'failed'} phase
 */
function setSubmitPhase(phase) {
  const { disabled, label } = submitButtonState({
    phase,
    sendable: isSendableTabUrl(state?.tabUrl),
  });
  els.submit.disabled = disabled;
  els.submitLabel.textContent = label;
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
    cacheTheme(me.theme);
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

  setSubmitPhase('idle');
  if (!isSendableTabUrl(tabUrl)) {
    setStatus('warn', 'Abra uma página http(s). chrome:// e extensões não são suportados.');
  }

  els.submit.addEventListener('click', onSubmit);
  els.openLogin.addEventListener('click', () => {
    if (!state) return;
    chrome.tabs.create({ url: loginUrl(state.baseUrl, '/fila') });
  });
  els.openJob.addEventListener('click', () => {
    const jobId = els.openJob.dataset.jobId;
    const base = els.openJob.dataset.baseUrl || state?.baseUrl;
    if (!base || !jobId) return;
    chrome.tabs.create({ url: jobPageUrl(base, jobId) });
  });
  els.openTranscript.addEventListener('click', () => {
    const tid = els.openTranscript.dataset.transcriptId;
    const base = els.openTranscript.dataset.baseUrl || state?.baseUrl;
    if (!base || !tid) return;
    chrome.tabs.create({ url: transcriptPageUrl(base, tid) });
  });

  await restorePersistedJob();
}

/**
 * O documento do popup morre quando ele fecha, então o que sobrevive é o
 * estado no `chrome.storage.local` mantido pelo service worker. Aqui ele é
 * lido de volta: job ainda em andamento vira progresso, job que terminou com
 * o popup fechado vira resultado, e o resto é o estado inicial.
 */
async function restorePersistedJob() {
  const stored = await chrome.storage.local.get([TRACKED_JOBS_KEY, LAST_OUTCOME_KEY]);
  const view = selectPopupState({
    trackedJobs: stored[TRACKED_JOBS_KEY],
    lastOutcome: stored[LAST_OUTCOME_KEY],
    now: Date.now(),
  });

  if (view.kind === 'outcome') {
    renderOutcome(view.outcome);
    settleJob(view.outcome.jobId);
    return;
  }

  if (view.kind === 'tracking') {
    tracking = {
      jobId: view.job.jobId,
      baseUrl: view.job.baseUrl,
      token: view.job.token || '',
      pageTitle: view.job.pageTitle || '',
    };
    setSubmitPhase('tracking');
    setStatus('ok', 'Envio em andamento. Avisamos quando ficar pronto.');
    showProgress(stageLabel('queued'));
    showJobAction(tracking.jobId, tracking.baseUrl);
    await refreshJobStatus();
    startPopupPoll();
  }
}

async function onSubmit() {
  if (!state || !isSendableTabUrl(state.tabUrl)) return;
  stopPoll();
  tracking = null;
  hideActions();
  els.resultCard.classList.add('hidden');
  setSubmitPhase('sending');
  setStatus('', '');
  showProgress('Enfileirando…');

  const permitted = await ensureHostPermission(state.baseUrl);
  if (!permitted) {
    endProgress(false);
    setStatus('err', 'Permissão de acesso à instância negada. Autorize o host para continuar.');
    setSubmitPhase('idle');
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
    setSubmitPhase('idle');
    return;
  }

  const existing = result.status === 'existing' ? ' (já na fila)' : '';
  setStatus('ok', `Na fila${existing}. Acompanhe aqui — avisamos quando ficar pronto.`);
  setSubmitPhase('tracking');
  showProgress(stageLabel('queued'));
  showJobAction(result.jobId, state.baseUrl);

  tracking = {
    jobId: result.jobId,
    baseUrl: state.baseUrl,
    token: state.token || '',
    pageTitle: state.tabTitle,
  };

  // Rastreamento no service worker: sobrevive ao fechamento do popup e é o
  // que permite restaurar o progresso na próxima abertura (além das
  // notificações).
  notifyBackground({ type: 'track-job', payload: { ...tracking } });

  // Poll no popup enquanto aberto (mais responsivo que o alarm do worker).
  startPopupPoll();
}

/**
 * @param {string} jobId
 * @param {string} baseUrl
 */
function showJobAction(jobId, baseUrl) {
  els.openJob.dataset.jobId = jobId;
  els.openJob.dataset.baseUrl = baseUrl || '';
  els.actions.classList.remove('hidden');
  els.openJob.classList.remove('hidden');
}

/**
 * @param {{ type: string, payload?: unknown }} message
 */
function notifyBackground(message) {
  try {
    const sent = chrome.runtime.sendMessage(message);
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch {
    /* service worker indisponível — o estado local já foi renderizado */
  }
}

/**
 * Avisa o worker que este popup já mostrou o desfecho do job: ele para de
 * rastrear e descarta o resultado guardado.
 * @param {string} jobId
 */
function settleJob(jobId) {
  notifyBackground({ type: 'job-settled', payload: { jobId } });
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPopupPoll() {
  stopPoll();
  pollTicks = 0;
  pollTimer = setInterval(() => void pollTick(), 2000);
}

async function pollTick() {
  if (!tracking) {
    stopPoll();
    return;
  }
  pollTicks += 1;
  if (pollTicks > 120) {
    // ~4 min — o worker segue rastreando e notifica quando terminar.
    stopPoll();
    els.progressLabel.textContent = 'Ainda processando — avisaremos por notificação.';
    setSubmitPhase('unavailable');
    return;
  }
  await refreshJobStatus();
}

/**
 * Uma consulta ao status do job em acompanhamento. Falha de consulta nunca
 * descarta o rastreamento nem apresenta o job como concluído/falho — só
 * sinaliza que o acompanhamento está indisponível.
 *
 * E "indisponível" libera o botão de envio: não saber em que pé está o job
 * não é o mesmo que estar ocupado. Sem isso, uma instância fora do ar (ou um
 * job que nunca resolve) deixava o usuário sem conseguir enfileirar nada.
 */
async function refreshJobStatus() {
  if (!tracking) return;
  const r = await fetchJobStatus({
    baseUrl: tracking.baseUrl,
    jobId: tracking.jobId,
    token: tracking.token || null,
  });

  if (!r.ok) {
    setSubmitPhase('unavailable');
    if (r.code === 'unauthorized') {
      els.progressLabel.textContent = 'Acompanhamento pausado — sessão expirada.';
      setStatus('warn', 'Entre na instância para voltar a acompanhar este envio.');
      els.actions.classList.remove('hidden');
      els.openLogin.classList.remove('hidden');
      return;
    }
    els.progressLabel.textContent = 'Acompanhamento indisponível no momento.';
    return;
  }

  renderJobStatus(r.job);
}

/**
 * @param {{ id: string, status: string, type?: string | null,
 *   progressStage?: string | null }} job Job normalizado por `fetchJobStatus`.
 */
function renderJobStatus(job) {
  if (classifyJobStatus(job.status) === 'pending') {
    // Consulta voltou a funcionar: o job está mesmo em andamento, então o
    // envio volta a ficar ocupado (pode ter sido liberado por uma falha
    // anterior de acompanhamento).
    setSubmitPhase('tracking');
    els.progressLabel.textContent = stageLabel(
      job.progressStage || String(job.status || '').toLowerCase(),
      job.type,
    );
    return;
  }

  stopPoll();
  const outcome = buildJobOutcome({ job, tracked: tracking ?? undefined, now: Date.now() });
  if (!outcome) return;
  renderOutcome(outcome);
  settleJob(outcome.jobId);
}

/**
 * Desfecho final do job — vindo do poll deste popup ou do resultado guardado
 * pelo worker enquanto o popup estava fechado.
 * @param {import('./lib/job-state.js').JobOutcome} outcome
 */
function renderOutcome(outcome) {
  const baseUrl = outcome.baseUrl || state?.baseUrl || '';
  showProgress('');
  showJobAction(outcome.jobId, baseUrl);

  if (outcome.outcome === 'succeeded') {
    endProgress(true);
    setStatus('ok', 'Pronto!');
    els.resultCard.classList.remove('hidden');
    els.resultTitle.textContent = outcome.title || state?.tabTitle || 'Conteúdo salvo';
    els.resultSummary.textContent =
      outcome.summary || 'Conteúdo disponível na sua base. Abra para ler.';
    if (outcome.transcriptId) {
      els.openTranscript.classList.remove('hidden');
      els.openTranscript.dataset.transcriptId = outcome.transcriptId;
      els.openTranscript.dataset.baseUrl = baseUrl;
    }
    setSubmitPhase('succeeded');
    return;
  }

  endProgress(false);
  setStatus('err', outcome.errorMsg || 'O processamento falhou.');
  setSubmitPhase('failed');
}

void load();
