/**
 * Service worker MV3 — first-run, tracking de jobs, notificações e update check.
 */

import {
  EXTENSION_VERSION,
  jobPageUrl,
  loginUrl,
  normalizeBaseUrl,
  transcriptPageUrl,
} from './lib/config.js';
import {
  compareSemver,
  fetchExtensionVersion,
  fetchJobStatus,
} from './lib/api.js';
import {
  LAST_OUTCOME_KEY,
  TRACKED_JOBS_KEY,
  buildJobOutcome,
  classifyJobStatus,
  pickLatestOutcome,
  pruneExpiredJobs,
  withoutJob,
} from './lib/job-state.js';

const TRACK_ALARM = 'voxen-job-track';
const UPDATE_ALARM = 'voxen-update-check';

// `chrome.action` não aceita CSS var, então o token --color-accent-primary do
// tema padrão (theme.css / apps/web) entra aqui como literal. Se a paleta do
// design system mudar, atualizar junto.
const BADGE_COLOR = '#8b7cf6';

/**
 * Fila que serializa os ciclos ler-alterar-gravar de `trackedJobs` /
 * `lastJobOutcome`.
 *
 * Ser "o único que escreve" não basta: `trackJob`, `pollTrackedJobs` e
 * `settleJob` são `async` e cedem o controle em cada `await`, então duas
 * invocações dentro do mesmo worker se intercalam — uma lê o mapa, a outra
 * grava, e a primeira regrava por cima o que tinha lido. Isso já ressuscitava
 * o `lastJobOutcome` de um job que o popup acabara de reconhecer e já sumia
 * com job recém-enfileirado durante um poll. A fila garante que cada ciclo
 * rode inteiro antes do próximo começar.
 *
 * Só vale dentro de uma instância do service worker — e isso basta: o MV3
 * mantém no máximo uma viva por vez, e se ela for encerrada no meio a escrita
 * simplesmente não acontece (nada fica pela metade no storage).
 *
 * Regra ao usar: nenhuma seção crítica pode conter `fetch`. A rede fica fora
 * do lock (ver `pollTrackedJobs`), senão o popup ficaria esperando a rodada
 * inteira de consultas para conseguir reconhecer um resultado.
 *
 * @type {Promise<unknown>}
 */
let storageQueue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} critical
 * @returns {Promise<T>}
 */
function withStorageLock(critical) {
  const run = storageQueue.then(critical, critical);
  storageQueue = run.catch(() => {});
  return run;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const stored = await chrome.storage.sync.get(['baseUrl']);
    const parsed = normalizeBaseUrl(stored.baseUrl ?? '');
    if (!parsed.ok) {
      chrome.runtime.openOptionsPage();
    }
  }
  if (details.reason === 'update') {
    chrome.notifications.create(`voxen-updated-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Voxen atualizado',
      message: `Agora na versão ${EXTENSION_VERSION}.`,
      priority: 0,
    });
  }
  // Agenda checagem de versão (6h).
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 360 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 360 });
});

/**
 * Mensagens do popup/options.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'track-job') {
    void trackJob(message.payload).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'job-settled') {
    void settleJob(message.payload?.jobId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'check-update') {
    void checkForUpdate(true).then((r) => sendResponse(r));
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TRACK_ALARM) {
    void pollTrackedJobs();
  }
  if (alarm.name === UPDATE_ALARM) {
    void checkForUpdate(false);
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const data = await chrome.storage.local.get(['notificationLinks']);
  const links = data.notificationLinks || {};
  const url = links[notificationId];
  if (url) {
    chrome.tabs.create({ url });
    delete links[notificationId];
    await chrome.storage.local.set({ notificationLinks: links });
  }
});

/**
 * @param {{ jobId: string, baseUrl: string, token?: string, pageTitle?: string }} payload
 */
async function trackJob(payload) {
  if (!payload?.jobId || !payload?.baseUrl) return;
  const remaining = await withStorageLock(async () => {
    const stored = await chrome.storage.local.get([TRACKED_JOBS_KEY]);
    const tracked = pruneExpiredJobs(stored[TRACKED_JOBS_KEY], Date.now());
    tracked[payload.jobId] = {
      jobId: payload.jobId,
      baseUrl: payload.baseUrl,
      token: payload.token || '',
      pageTitle: payload.pageTitle || '',
      startedAt: Date.now(),
    };
    await chrome.storage.local.set({ [TRACKED_JOBS_KEY]: tracked });
    return Object.keys(tracked).length;
  });
  // Poll frequente enquanto houver jobs.
  chrome.alarms.create(TRACK_ALARM, { periodInMinutes: 0.05 }); // ~3s
  // Badge
  await refreshBadge(remaining);
}

async function pollTrackedJobs() {
  const stored = await chrome.storage.local.get([TRACKED_JOBS_KEY]);
  /** @type {Record<string, import('./lib/job-state.js').TrackedJob>} */
  const snapshot = pruneExpiredJobs(stored[TRACKED_JOBS_KEY], Date.now());

  /** Ids que esta rodada resolveu — terminaram ou perderam a sessão. */
  const settledIds = [];
  /**
   * Desfechos terminais desta rodada. Só um vai para o storage (o popup
   * mostra um), mas a escolha é feita depois e por critério explícito — cada
   * job resolvido já gerou a sua notificação, então nada se perde de fato.
   * @type {Array<{ startedAt?: number, outcome: import('./lib/job-state.js').JobOutcome }>}
   */
  const roundOutcomes = [];

  // Fase de rede: fora do lock de storage, é a parte lenta.
  for (const id of Object.keys(snapshot)) {
    const item = snapshot[id];
    const result = await fetchJobStatus({
      baseUrl: item.baseUrl,
      jobId: item.jobId,
      token: item.token || null,
    });

    if (!result.ok) {
      if (result.code === 'unauthorized') {
        // Para de poluir; avisa uma vez.
        await notifyOnce(
          `auth-${item.jobId}`,
          'Sessão Voxen expirada',
          'Faça login de novo para acompanhar o processamento.',
          loginUrl(item.baseUrl, '/fila'),
        );
        settledIds.push(id);
      }
      // Demais erros (404, 5xx, rede) não descartam o rastreamento: a falha
      // pode ser transitória. Quem impede o zumbi eterno é o TTL aplicado no
      // `pruneExpiredJobs` acima.
      continue;
    }

    const kind = classifyJobStatus(result.job.status);
    if (kind === 'pending') continue;

    const outcome = buildJobOutcome({ job: result.job, tracked: item, now: Date.now() });
    if (outcome) roundOutcomes.push({ startedAt: item.startedAt, outcome });

    if (kind === 'succeeded') {
      const title = result.job.title || item.pageTitle || 'Conteúdo pronto';
      const summary = result.job.summary || 'Abra no Voxen para ler o conteúdo completo.';
      const link = result.job.transcriptId
        ? transcriptPageUrl(item.baseUrl, result.job.transcriptId)
        : jobPageUrl(item.baseUrl, item.jobId);
      await notifyOnce(
        `done-${item.jobId}`,
        `Pronto: ${truncate(title, 48)}`,
        truncate(summary, 120),
        link,
      );
    } else {
      await notifyOnce(
        `fail-${item.jobId}`,
        'Falha no processamento',
        truncate(result.job.errorMsg || 'O job não concluiu.', 120),
        jobPageUrl(item.baseUrl, item.jobId),
      );
    }
    settledIds.push(id);
  }

  // Fase de escrita: atômica em relação a `trackJob` e `settleJob`.
  const remaining = await withStorageLock(async () => {
    const fresh = await chrome.storage.local.get([TRACKED_JOBS_KEY]);
    // Relê em vez de reaproveitar o snapshot: durante os `fetch` acima o popup
    // pode ter enfileirado outro envio ou reconhecido um resultado. Partir do
    // estado atual e remover só o que esta rodada resolveu preserva os dois.
    const current = pruneExpiredJobs(fresh[TRACKED_JOBS_KEY], Date.now());
    const next = { ...current };
    for (const id of settledIds) delete next[id];

    // Desfecho de job que o popup já reconheceu (saiu de `current`) não volta
    // ao storage — reapareceria como novidade na próxima abertura.
    const chosen = pickLatestOutcome(
      roundOutcomes.filter((c) => Object.hasOwn(current, c.outcome.jobId)),
    );

    await chrome.storage.local.set({
      [TRACKED_JOBS_KEY]: next,
      ...(chosen ? { [LAST_OUTCOME_KEY]: chosen } : {}),
    });
    return Object.keys(next).length;
  });

  await refreshBadge(remaining);
  if (remaining === 0) {
    chrome.alarms.clear(TRACK_ALARM);
  }
}

/**
 * O popup já mostrou o desfecho deste job: para de rastrear e descarta o
 * resultado guardado (para não reaparecer na próxima abertura). Roda sob
 * `withStorageLock` porque concorre com a fase de escrita de
 * `pollTrackedJobs` — sem isso a rodada em voo regravaria o resultado que
 * acabou de ser reconhecido.
 * @param {string | undefined} jobId
 */
async function settleJob(jobId) {
  if (!jobId) return;
  const remaining = await withStorageLock(async () => {
    const stored = await chrome.storage.local.get([TRACKED_JOBS_KEY, LAST_OUTCOME_KEY]);
    const tracked = withoutJob(pruneExpiredJobs(stored[TRACKED_JOBS_KEY], Date.now()), jobId);
    /** @type {Record<string, unknown>} */
    const patch = { [TRACKED_JOBS_KEY]: tracked };
    if (stored[LAST_OUTCOME_KEY]?.jobId === jobId) {
      patch[LAST_OUTCOME_KEY] = null;
    }
    await chrome.storage.local.set(patch);
    return Object.keys(tracked).length;
  });

  await refreshBadge(remaining);
  if (remaining === 0) {
    chrome.alarms.clear(TRACK_ALARM);
  }
}

/**
 * @param {boolean} fromUser
 */
async function checkForUpdate(fromUser) {
  const stored = await chrome.storage.sync.get(['baseUrl']);
  const parsed = normalizeBaseUrl(stored.baseUrl ?? '');
  if (!parsed.ok) {
    return { ok: false, reason: 'no-base' };
  }

  const remote = await fetchExtensionVersion(parsed.baseUrl);
  if (!remote) {
    if (fromUser) {
      await notifyOnce(
        `upd-fail-${Date.now()}`,
        'Voxen',
        'Não foi possível checar atualizações agora.',
        `${parsed.baseUrl}/extensao`,
      );
    }
    return { ok: false, reason: 'fetch' };
  }

  const newer = compareSemver(remote.version, EXTENSION_VERSION) > 0;
  await chrome.storage.local.set({
    lastUpdateCheck: {
      at: Date.now(),
      remoteVersion: remote.version,
      hasUpdate: newer,
      pageUrl: remote.pageUrl || `${parsed.baseUrl}/extensao`,
      zipUrl: remote.zipUrl,
      notes: remote.notes,
    },
  });

  if (newer) {
    chrome.action.setBadgeText({ text: '↑' });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    if (fromUser || !(await alreadyNotifiedUpdate(remote.version))) {
      await notifyOnce(
        `upd-${remote.version}`,
        'Nova versão da extensão',
        `v${remote.version} disponível. Toque para baixar.`,
        remote.pageUrl || `${parsed.baseUrl}/extensao`,
      );
      await chrome.storage.local.set({ lastNotifiedUpdate: remote.version });
    }
  } else if (fromUser) {
    await notifyOnce(
      `upd-ok-${Date.now()}`,
      'Extensão atualizada',
      `Você já está na v${EXTENSION_VERSION}.`,
      `${parsed.baseUrl}/extensao`,
    );
  }

  return { ok: true, hasUpdate: newer, remoteVersion: remote.version };
}

async function alreadyNotifiedUpdate(version) {
  const s = await chrome.storage.local.get(['lastNotifiedUpdate']);
  return s.lastNotifiedUpdate === version;
}

/**
 * @param {string} id
 * @param {string} title
 * @param {string} message
 * @param {string} [link]
 */
async function notifyOnce(id, title, message, link) {
  if (link) {
    const data = await chrome.storage.local.get(['notificationLinks']);
    const links = data.notificationLinks || {};
    links[id] = link;
    await chrome.storage.local.set({ notificationLinks: links });
  }
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
    priority: 1,
  });
}

/**
 * @param {number} count
 */
async function refreshBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(Math.min(count, 9)) });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    return;
  }
  const s = await chrome.storage.local.get(['lastUpdateCheck']);
  if (s.lastUpdateCheck?.hasUpdate) {
    chrome.action.setBadgeText({ text: '↑' });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    return;
  }
  chrome.action.setBadgeText({ text: '' });
}

/**
 * @param {string} s
 * @param {number} n
 */
function truncate(s, n) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}
