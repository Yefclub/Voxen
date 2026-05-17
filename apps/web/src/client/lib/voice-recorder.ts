// Captura áudio do mic via MediaRecorder. Retorna Blob ao parar.

export interface VoiceRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
  isRecording(): boolean;
}

export function createVoiceRecorder(): VoiceRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let stopPromise: Promise<Blob> | null = null;

  async function start(): Promise<void> {
    chunks = [];
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    stopPromise = new Promise<Blob>((resolve) => {
      mediaRecorder!.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder!.mimeType || 'audio/webm' });
        cleanup();
        resolve(blob);
      };
    });
    mediaRecorder.start();
  }

  async function stop(): Promise<Blob> {
    if (!mediaRecorder || mediaRecorder.state === 'inactive' || !stopPromise) {
      throw new Error('Nada gravando.');
    }
    mediaRecorder.stop();
    return stopPromise;
  }

  function cancel(): void {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = null;
      mediaRecorder.stop();
    }
    cleanup();
  }

  function cleanup(): void {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    mediaRecorder = null;
  }

  function isRecording(): boolean {
    return !!mediaRecorder && mediaRecorder.state === 'recording';
  }

  return { start, stop, cancel, isRecording };
}

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}
