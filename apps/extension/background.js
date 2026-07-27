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

const TRACK_ALARM = 'voxen-job-track';
const UPDATE_ALARM = 'voxen-update-check';

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
  const stored = await chrome.storage.local.get(['trackedJobs']);
  /** @type {Record<string, object>} */
  const tracked = stored.trackedJobs || {};
  tracked[payload.jobId] = {
    jobId: payload.jobId,
    baseUrl: payload.baseUrl,
    token: payload.token || '',
    pageTitle: payload.pageTitle || '',
    startedAt: Date.now(),
  };
  await chrome.storage.local.set({ trackedJobs: tracked });
  // Poll frequente enquanto houver jobs.
  chrome.alarms.create(TRACK_ALARM, { periodInMinutes: 0.05 }); // ~3s
  // Badge
  await refreshBadge(Object.keys(tracked).length);
}

async function pollTrackedJobs() {
  const stored = await chrome.storage.local.get(['trackedJobs']);
  /** @type {Record<string, { jobId: string, baseUrl: string, token?: string, pageTitle?: string }>} */
  const tracked = stored.trackedJobs || {};
  const ids = Object.keys(tracked);
  if (ids.length === 0) {
    chrome.alarms.clear(TRACK_ALARM);
    await refreshBadge(0);
    return;
  }

  for (const id of ids) {
    const item = tracked[id];
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
        delete tracked[id];
      }
      continue;
    }

    const status = result.job.status;
    if (status === 'SUCCEEDED' || status === 'DONE' || status === 'COMPLETED') {
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
      delete tracked[id];
    } else if (status === 'FAILED' || status === 'CANCELLED') {
      await notifyOnce(
        `fail-${item.jobId}`,
        'Falha no processamento',
        truncate(result.job.errorMsg || 'O job não concluiu.', 120),
        jobPageUrl(item.baseUrl, item.jobId),
      );
      delete tracked[id];
    }
  }

  await chrome.storage.local.set({ trackedJobs: tracked });
  const remaining = Object.keys(tracked).length;
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
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
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
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    return;
  }
  const s = await chrome.storage.local.get(['lastUpdateCheck']);
  if (s.lastUpdateCheck?.hasUpdate) {
    chrome.action.setBadgeText({ text: '↑' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
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
