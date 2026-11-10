// Fake capture worker and AI client for the capture runner tests.

import type { AiRole, CaptureDeps } from '../../src/lib/capture/runner';
import type {
  AudioFormat,
  WorkerAudio,
  WorkerExtraction,
  WorkerFileResult,
  WorkerFrames,
} from '../../src/lib/capture/worker-client';

export const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function extraction(over: Partial<WorkerExtraction> = {}): WorkerExtraction {
  return {
    platform: 'web',
    canonicalUrl: 'https://example.com/a',
    platformId: null,
    title: 'Título da página',
    author: null,
    channel: 'Example',
    publishedAt: null,
    durationSec: null,
    language: 'pt',
    description: null,
    text: 'Conteúdo longo sobre filas duráveis no Postgres. '.repeat(20),
    textKind: 'page',
    segments: [],
    hasAudio: false,
    hasVideo: false,
    images: [],
    comments: [],
    extractor: 'trafilatura',
    ...over,
  };
}

export function fourFrames(): WorkerFrames {
  return {
    durationSec: 13,
    images: [2, 5, 8, 11].map((timeSec) => ({
      kind: 'frame',
      mime: 'image/png',
      dataBase64: PNG_1PX,
      timeSec,
    })),
  };
}

export type Calls = {
  extract: number;
  audio: number;
  audioFormats: string[];
  file: number;
  fileFormats: string[];
  frames: number;
  stt: number;
  sttMimes: string[];
  generate: AiRole[];
  /** Untrusted text sent to each interpretation call. */
  prompts: string[];
  /** Images sent to each vision call. */
  visionImages: number[];
  /** Schema of each interpretation call. */
  schemas: unknown[];
  instructions: string[];
};

export function freshCalls(): Calls {
  return {
    extract: 0,
    audio: 0,
    audioFormats: [],
    file: 0,
    fileFormats: [],
    frames: 0,
    stt: 0,
    sttMimes: [],
    generate: [],
    prompts: [],
    visionImages: [],
    schemas: [],
    instructions: [],
  };
}

type Transcript = Awaited<ReturnType<CaptureDeps['ai']['transcribeAudio']>>;

export type FakeOptions = {
  calls: Calls;
  extract?: () => Promise<WorkerExtraction>;
  file?: () => Promise<WorkerFileResult>;
  audio?: (format: AudioFormat | undefined) => Promise<WorkerAudio>;
  audioDurationSec?: number;
  frames?: () => Promise<WorkerFrames>;
  roles?: AiRole[];
  sttFormat?: AudioFormat;
  transcribe?: () => Promise<Transcript>;
  vision?: () => Promise<never>;
  interpretation?: Record<string, unknown>;
};

export function makeDeps(opts: FakeOptions): CaptureDeps {
  const roles = new Set<AiRole>(opts.roles ?? ['fast', 'standard', 'vision', 'stt']);
  const configured = (role: AiRole) =>
    roles.has(role) || (role === 'standard' && roles.has('fast'));
  return {
    worker: {
      extract: async () => {
        opts.calls.extract += 1;
        return (opts.extract ?? (async () => extraction()))();
      },
      audio: async (_url, _signal, format) => {
        opts.calls.audio += 1;
        opts.calls.audioFormats.push(format ?? 'default');
        if (opts.audio) return opts.audio(format);
        return {
          durationSec: opts.audioDurationSec ?? 40,
          chunks: [{ startSec: 0, mime: 'audio/mpeg', dataBase64: 'AAAA' }],
        };
      },
      frames: async () => {
        opts.calls.frames += 1;
        return (opts.frames ?? (async () => fourFrames()))();
      },
      file: async (input) => {
        opts.calls.file += 1;
        opts.calls.fileFormats.push(input.format ?? 'default');
        if (!opts.file) throw new Error('not used');
        return opts.file();
      },
    },
    ai: {
      isRoleConfigured: async (_userId, role) => configured(role),
      chainLength: async (_userId, role) => (configured(role) ? 1 : 0),
      sttAudioFormat: async () => opts.sttFormat ?? 'mp3',
      generateStructured: async <T>(input: {
        role: AiRole;
        untrusted: Array<{ text: string } | { image: Uint8Array; mime: string }>;
        schema: unknown;
        instructions: string;
      }) => {
        opts.calls.generate.push(input.role);
        if (input.role === 'vision') {
          const images = input.untrusted.filter((part) => 'image' in part).length;
          opts.calls.visionImages.push(images);
          if (opts.vision) return opts.vision();
          return {
            output: {
              descriptions: Array.from({ length: images }, (_, i) => ({
                index: i + 1,
                description: `Um gráfico de barras (imagem ${i + 1}).`,
              })),
            } as T,
            modelRef: 'anthropic:claude-haiku-5-5',
            costUsd: 0.0001,
          };
        }
        opts.calls.prompts.push(
          input.untrusted.map((part) => ('text' in part ? part.text : '')).join('\n'),
        );
        opts.calls.schemas.push(input.schema);
        opts.calls.instructions.push(input.instructions);
        return {
          output: {
            title: 'Filas duráveis no Postgres',
            language: 'pt',
            summary_md: 'Explica filas com SKIP LOCKED. Veja https://evil.example.',
            key_points: ['Usa SKIP LOCKED'],
            tags: ['Postgres', '#filas', 'postgres'],
            entities: [{ name: 'PostgreSQL', kind: 'software' }],
            ...opts.interpretation,
          } as T,
          modelRef: 'anthropic:claude-haiku-5-5',
          costUsd: 0.0003,
        };
      },
      transcribeAudio: async (input) => {
        opts.calls.stt += 1;
        opts.calls.sttMimes.push(...input.chunks.map((chunk) => chunk.mime));
        if (opts.transcribe) return opts.transcribe();
        return {
          text: 'Fala transcrita sobre bancos de dados. '.repeat(10),
          segments: [{ startSec: 0, endSec: 5, text: 'Fala transcrita sobre bancos de dados.' }],
          language: 'pt',
          model: 'openai:gpt-transcribe',
          costUsd: 0.003,
        };
      },
    },
  };
}
