import { describe, expect, mock, test } from 'bun:test';
import {
  buildJobSystemNotification,
  ensureNotificationPermission,
  readNotificationPermission,
  resolveTerminalJobFeedback,
  shouldAutoOpenTranscript,
  showSystemNotification,
} from './job-terminal-feedback';

describe('resolveTerminalJobFeedback', () => {
  test('visível → toast para done/failed/cancelled', () => {
    for (const stage of ['done', 'failed', 'cancelled'] as const) {
      expect(
        resolveTerminalJobFeedback({
          stage,
          documentHidden: false,
          notificationPermission: 'granted',
        }),
      ).toBe('toast');
    }
  });

  test('hidden + granted → notification para done/failed; cancelled fica none', () => {
    expect(
      resolveTerminalJobFeedback({
        stage: 'done',
        documentHidden: true,
        notificationPermission: 'granted',
      }),
    ).toBe('notification');
    expect(
      resolveTerminalJobFeedback({
        stage: 'failed',
        documentHidden: true,
        notificationPermission: 'granted',
      }),
    ).toBe('notification');
    expect(
      resolveTerminalJobFeedback({
        stage: 'cancelled',
        documentHidden: true,
        notificationPermission: 'granted',
      }),
    ).toBe('none');
  });

  test('hidden sem permission → none (sem fila de toast)', () => {
    expect(
      resolveTerminalJobFeedback({
        stage: 'done',
        documentHidden: true,
        notificationPermission: 'denied',
      }),
    ).toBe('none');
    expect(
      resolveTerminalJobFeedback({
        stage: 'done',
        documentHidden: true,
        notificationPermission: 'default',
      }),
    ).toBe('none');
    expect(
      resolveTerminalJobFeedback({
        stage: 'done',
        documentHidden: true,
        notificationPermission: 'unsupported',
      }),
    ).toBe('none');
  });
});

describe('buildJobSystemNotification', () => {
  const labels = {
    readyTitle: 'Transcrição pronta.',
    readyBody: 'Disponível na Biblioteca.',
    failedTitle: 'Transcrição falhou.',
    failedBody: 'Algo deu errado.',
  };

  test('done aponta para a transcrição quando há id', () => {
    expect(
      buildJobSystemNotification({
        stage: 'done',
        jobId: 'job-1',
        transcriptId: 'tr-9',
        labels,
      }),
    ).toEqual({
      title: 'Transcrição pronta.',
      body: 'Disponível na Biblioteca.',
      icon: '/voxen-192.png',
      tag: 'voxen-job-job-1-done',
      url: '/transcricoes/tr-9',
    });
  });

  test('failed usa errorMsg e aponta para o job', () => {
    expect(
      buildJobSystemNotification({
        stage: 'failed',
        jobId: 'job-2',
        errorMsg: 'yt-dlp morreu',
        labels,
      }),
    ).toMatchObject({
      title: 'Transcrição falhou.',
      body: 'yt-dlp morreu',
      tag: 'voxen-job-job-2-failed',
      url: '/jobs/job-2',
    });
  });

  test('download concluído aponta para a biblioteca de mídia', () => {
    expect(
      buildJobSystemNotification({
        stage: 'done',
        jobId: 'job-media',
        savedMediaReady: true,
        labels: {
          ...labels,
          mediaReadyTitle: 'Mídia salva.',
          mediaReadyBody: 'Disponível em Downloads.',
        },
      }),
    ).toMatchObject({
      title: 'Mídia salva.',
      body: 'Disponível em Downloads.',
      url: '/downloads',
    });
  });

  test('outro job sem transcrição continua apontando para seus detalhes', () => {
    expect(
      buildJobSystemNotification({
        stage: 'done',
        jobId: 'job-maintenance',
        labels,
      }),
    ).toMatchObject({
      title: 'Transcrição pronta.',
      url: '/jobs/job-maintenance',
    });
  });

  test('exclusão concluída usa mensagem própria e aponta para a auditoria do job', () => {
    expect(
      buildJobSystemNotification({
        stage: 'done',
        jobId: 'job-delete',
        deletionReady: true,
        labels: {
          ...labels,
          deletionReadyTitle: 'Conteúdo removido.',
          deletionReadyBody: 'A base e o grafo foram atualizados.',
        },
      }),
    ).toMatchObject({
      title: 'Conteúdo removido.',
      body: 'A base e o grafo foram atualizados.',
      url: '/jobs/job-delete',
    });
  });
});

describe('shouldAutoOpenTranscript', () => {
  test('navega só no DONE com transcript, visível e na rota do job focado', () => {
    expect(
      shouldAutoOpenTranscript({
        stage: 'DONE',
        transcriptId: 'tr-1',
        documentHidden: false,
        pathname: '/jobs/abc',
        jobId: 'abc',
      }),
    ).toBe('/transcricoes/tr-1');

    expect(
      shouldAutoOpenTranscript({
        stage: 'done',
        transcriptId: 'tr-1',
        documentHidden: false,
        pathname: '/jobs/abc/',
        jobId: 'abc',
      }),
    ).toBe('/transcricoes/tr-1');
  });

  test('não hijacka outras rotas, background ou jobs sem transcript', () => {
    expect(
      shouldAutoOpenTranscript({
        stage: 'DONE',
        transcriptId: 'tr-1',
        documentHidden: true,
        pathname: '/jobs/abc',
        jobId: 'abc',
      }),
    ).toBeNull();

    expect(
      shouldAutoOpenTranscript({
        stage: 'DONE',
        transcriptId: 'tr-1',
        documentHidden: false,
        pathname: '/transcricoes',
        jobId: 'abc',
      }),
    ).toBeNull();

    expect(
      shouldAutoOpenTranscript({
        stage: 'DONE',
        transcriptId: 'tr-1',
        documentHidden: false,
        pathname: '/jobs/other',
        jobId: 'abc',
      }),
    ).toBeNull();

    expect(
      shouldAutoOpenTranscript({
        stage: 'FAILED',
        transcriptId: 'tr-1',
        documentHidden: false,
        pathname: '/jobs/abc',
        jobId: 'abc',
      }),
    ).toBeNull();

    expect(
      shouldAutoOpenTranscript({
        stage: 'DONE',
        transcriptId: null,
        documentHidden: false,
        pathname: '/jobs/abc',
        jobId: 'abc',
      }),
    ).toBeNull();
  });
});

describe('notification permission + show', () => {
  test('readNotificationPermission mapeia estados', () => {
    expect(readNotificationPermission(null)).toBe('unsupported');
    expect(readNotificationPermission({ permission: 'granted' })).toBe('granted');
    expect(readNotificationPermission({ permission: 'denied' })).toBe('denied');
    expect(readNotificationPermission({ permission: 'default' })).toBe('default');
  });

  test('ensureNotificationPermission pede só quando default e não quebra se falhar', async () => {
    expect(await ensureNotificationPermission(null)).toBe('unsupported');
    expect(await ensureNotificationPermission({ permission: 'granted' })).toBe('granted');
    expect(await ensureNotificationPermission({ permission: 'denied' })).toBe('denied');

    const requestPermission = mock(async () => 'granted' as NotificationPermission);
    expect(await ensureNotificationPermission({ permission: 'default', requestPermission })).toBe(
      'granted',
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);

    expect(
      await ensureNotificationPermission({
        permission: 'default',
        requestPermission: async () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('default');
  });

  test('showSystemNotification usa SW registration e degrada sem crash', async () => {
    const showNotification = mock(async () => undefined);
    const ok = await showSystemNotification(
      {
        title: 'T',
        body: 'B',
        icon: '/i.png',
        tag: 't1',
        url: '/jobs/1',
      },
      {
        getRegistration: async () => ({ showNotification }) as unknown as ServiceWorkerRegistration,
        NotificationCtor: null,
      },
    );
    expect(ok).toBe(true);
    expect(showNotification).toHaveBeenCalledTimes(1);

    const failed = await showSystemNotification(
      {
        title: 'T',
        body: 'B',
        icon: '/i.png',
        tag: 't1',
        url: '/jobs/1',
      },
      {
        getRegistration: async () => {
          throw new Error('no sw');
        },
        NotificationCtor: null,
      },
    );
    expect(failed).toBe(false);
  });
});
