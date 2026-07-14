import { describe, expect, it } from 'bun:test';
import {
  attachmentKind,
  formatToolDuration,
  hasToolLabel,
  pendingHitlFromTools,
  prettifyToolName,
  toolBlockState,
  toolFamily,
} from '../src/client/lib/chat-tools';

describe('toolFamily', () => {
  it('mapeia buscas', () => {
    expect(toolFamily('search_transcripts')).toBe('search');
    expect(toolFamily('search_notes')).toBe('search');
  });
  it('mapeia leituras/recuperação progressiva', () => {
    expect(toolFamily('read_lines')).toBe('read');
    expect(toolFamily('outline_transcript')).toBe('read');
    expect(toolFamily('verify_citations')).toBe('read');
  });
  it('mapeia brain e notas', () => {
    expect(toolFamily('brain_search')).toBe('brain');
    expect(toolFamily('related')).toBe('brain');
    expect(toolFamily('propose_create_note')).toBe('notes');
  });
  it('mapeia web e transcrição', () => {
    expect(toolFamily('web_search')).toBe('web');
    expect(toolFamily('transcribe_video')).toBe('transcript');
  });
  it('mapeia ingestão de URL (request_transcription/get_job_status)', () => {
    expect(toolFamily('request_transcription')).toBe('transcript');
    expect(toolFamily('get_job_status')).toBe('transcript');
  });
  it('desconhecido cai em other', () => {
    expect(toolFamily('mystery_tool')).toBe('other');
  });
});

describe('prettifyToolName / hasToolLabel', () => {
  it('prettify troca underscores e capitaliza', () => {
    expect(prettifyToolName('some_new_tool')).toBe('Some new tool');
  });
  it('hasToolLabel reconhece nomes conhecidos', () => {
    expect(hasToolLabel('search_transcripts')).toBe(true);
    expect(hasToolLabel('mystery_tool')).toBe(false);
  });
  it('hasToolLabel reconhece as tools de ingestão de URL', () => {
    expect(hasToolLabel('request_transcription')).toBe(true);
    expect(hasToolLabel('get_job_status')).toBe(true);
  });
});

describe('pendingHitlFromTools', () => {
  it('extrai aprovações pendentes com approvalId', () => {
    expect(
      pendingHitlFromTools([
        {
          name: 'propose_create_note',
          state: 'approval-required',
          output: {
            approvalRequired: true,
            approvalId: '11111111-1111-1111-1111-111111111111',
            action: 'create_note',
            title: 'Minha nota',
          },
        },
        { name: 'web_search', state: 'completed', output: { ok: true } },
      ]),
    ).toEqual([
      {
        approvalId: '11111111-1111-1111-1111-111111111111',
        toolName: 'propose_create_note',
        title: 'Minha nota',
        action: 'create_note',
      },
    ]);
  });

  it('ignora ferramentas sem pedido de aprovação', () => {
    expect(
      pendingHitlFromTools([{ name: 'propose_create_note', state: 'completed', output: {} }]),
    ).toEqual([]);
  });
});

describe('toolBlockState', () => {
  it('running enquanto houver ferramenta rodando', () => {
    expect(
      toolBlockState([
        { name: 'a', state: 'completed' },
        { name: 'b', state: 'running' },
      ]),
    ).toBe('running');
  });
  it('approval-required não conta como running (HITL fora do Pensando)', () => {
    expect(toolBlockState([{ name: 'a', state: 'approval-required' }])).toBe('done');
  });
  it('error se alguma falhou e nenhuma roda', () => {
    expect(
      toolBlockState([
        { name: 'a', state: 'completed' },
        { name: 'b', state: 'error' },
      ]),
    ).toBe('error');
  });
  it('done quando todas concluíram sem erro', () => {
    expect(toolBlockState([{ name: 'a', state: 'completed' }])).toBe('done');
  });
});

describe('formatToolDuration', () => {
  it('abaixo de 10s usa 1 casa com vírgula', () => {
    expect(formatToolDuration(400)).toBe('0,4s');
    expect(formatToolDuration(1800)).toBe('1,8s');
  });
  it('entre 10s e 60s usa inteiro', () => {
    expect(formatToolDuration(10500)).toBe('11s');
  });
  it('a partir de 1 min usa m e ss', () => {
    expect(formatToolDuration(65000)).toBe('1m 05s');
    expect(formatToolDuration(125000)).toBe('2m 05s');
  });
  it('segundos que arredondam pra 60 sobem pro minuto', () => {
    expect(formatToolDuration(119600)).toBe('2m 00s');
    expect(formatToolDuration(59600)).toBe('1m 00s');
  });
  it('negativo vira zero', () => {
    expect(formatToolDuration(-10)).toBe('0,0s');
  });
});

describe('attachmentKind', () => {
  it('imagem por MIME e por extensão', () => {
    expect(attachmentKind('foto.png', 'image/png')).toBe('image');
    expect(attachmentKind('foto.WEBP', '')).toBe('image');
  });
  it('mídia (áudio/vídeo) por MIME e extensão', () => {
    expect(attachmentKind('aula.mp4', 'video/mp4')).toBe('media');
    expect(attachmentKind('podcast.mp3', '')).toBe('media');
    expect(attachmentKind('nota.ogg', 'audio/ogg')).toBe('media');
  });
  it('documento por extensão e por MIME', () => {
    expect(attachmentKind('relatorio.pdf', 'application/pdf')).toBe('document');
    expect(attachmentKind('planilha.xlsx', '')).toBe('document');
    expect(attachmentKind('dados', 'text/csv')).toBe('document');
  });
  it('tipo não suportado retorna null', () => {
    expect(attachmentKind('binario.exe', 'application/octet-stream')).toBeNull();
  });
});
