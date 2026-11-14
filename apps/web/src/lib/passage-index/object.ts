import { storageGet } from '../storage';
import { structuredDiagnostic } from '../structured-log';
import { PassageBuildError } from './build';

/** Bounds allocation and elapsed I/O even when object metadata is unreliable. */
export async function readPassageObject(
  key: string,
  get = storageGet,
  timeoutMs = 30_000,
): Promise<string> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('INVALID_DEADLINE');
  const controller = new AbortController(),
    signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  const aborted = new Promise<never>((_resolve, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
  );
  const cancelFailure = (error: unknown) =>
    structuredDiagnostic('warning', 'passage-object-cancel-failed', 'PASSAGE_INDEX_FAILED', error);
  const read = async () => {
    const object = await get(key, undefined, signal);
    if (signal.aborted || object.totalSize > 16_000_000 || object.contentLength > 16_000_000) {
      await object.body.cancel().catch(cancelFailure);
      signal.throwIfAborted();
      throw new PassageBuildError('INDEX_CAPACITY');
    }
    const reader = object.body.getReader(),
      decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const cancel = () => {
      void reader.cancel(signal.reason).catch(cancelFailure);
    };
    signal.addEventListener('abort', cancel, { once: true });
    let bytes = 0,
      units = 0;
    const parts: string[] = [];
    const append = (chunk?: Uint8Array) => {
      let text: string;
      try {
        text = decoder.decode(chunk, { stream: chunk !== undefined });
      } catch {
        throw new PassageBuildError('INVALID_SOURCE');
      }
      units += text.length;
      if (units > 4_000_000) throw new PassageBuildError('INDEX_CAPACITY');
      parts.push(text);
    };
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16_000_000) throw new PassageBuildError('INDEX_CAPACITY');
        append(value);
      }
      append();
      return parts.join('');
    } finally {
      signal.removeEventListener('abort', cancel);
      if (!signal.aborted) await reader.cancel().catch(cancelFailure);
    }
  };
  try {
    return await Promise.race([read(), aborted]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
