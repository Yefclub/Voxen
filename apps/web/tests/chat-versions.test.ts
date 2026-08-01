import { describe, expect, it } from 'bun:test';
import {
  hasMessageVersions,
  planSend,
  truncateTrailFrom,
  versionNeighborId,
} from '../src/client/lib/chat-versions';

const THREE = { index: 2, total: 3, ids: ['v1', 'v2', 'v3'] };

describe('hasMessageVersions', () => {
  it('só reconhece ponto de ramificação', () => {
    expect(hasMessageVersions(THREE)).toBe(true);
    expect(hasMessageVersions(null)).toBe(false);
    expect(hasMessageVersions(undefined)).toBe(false);
    // Mensagem sem irmã não exibe indicador — é o que mantém a conversa
    // anterior à feature limpa.
    expect(hasMessageVersions({ index: 1, total: 1, ids: ['v1'] })).toBe(false);
  });
});

describe('versionNeighborId', () => {
  it('resolve a irmã anterior e a seguinte a partir da posição atual', () => {
    expect(versionNeighborId(THREE, -1)).toBe('v1');
    expect(versionNeighborId(THREE, 1)).toBe('v3');
  });

  it('para nas pontas em vez de dar a volta', () => {
    expect(versionNeighborId({ index: 1, total: 3, ids: ['v1', 'v2', 'v3'] }, -1)).toBeNull();
    expect(versionNeighborId({ index: 3, total: 3, ids: ['v1', 'v2', 'v3'] }, 1)).toBeNull();
  });

  it('sem ramificação não navega', () => {
    expect(versionNeighborId(null, 1)).toBeNull();
    expect(versionNeighborId({ index: 1, total: 1, ids: ['v1'] }, -1)).toBeNull();
  });

  it('confere o limite contra ids, não contra um total divergente', () => {
    // `total` só alimenta o rótulo. Se ele disser 5 e vierem 2 ids, avançar
    // pegaria `undefined` e o POST iria para /messages/undefined/activate.
    // `toBeNull` (e não `toBeUndefined`) é o que trava isso: quem chama trata
    // `null` como "seta desabilitada" e um `undefined` vazado passaria batido
    // pelo `!previousId` do componente mas não por uma comparação estrita.
    expect(versionNeighborId({ index: 2, total: 5, ids: ['v1', 'v2'] }, 1)).toBeNull();
  });
});

describe('planSend', () => {
  const composerJobIds = ['job-composer-1', 'job-composer-2'];

  it('envio normal vai para /api/chat e consome o composer', () => {
    expect(planSend({ composerJobIds })).toEqual({
      endpoint: '/api/chat',
      attachmentJobIds: ['job-composer-1', 'job-composer-2'],
      clearsComposer: true,
    });
  });

  it('reenvio vai para o endpoint de versão da mensagem editada', () => {
    const plan = planSend({
      branch: { messageId: 'msg_42', attachments: [] },
      composerJobIds,
    });
    expect(plan.endpoint).toBe('/api/chat/messages/msg_42/versions');
  });

  it('reenvio herda os anexos da mensagem editada e ignora os do composer', () => {
    // Sem isso, editar uma pergunta perde o PDF que a acompanhava e anexa por
    // engano o arquivo que o usuário preparou para a PRÓXIMA mensagem.
    const plan = planSend({
      branch: { messageId: 'msg_42', attachments: [{ jobId: 'job-da-mensagem' }] },
      composerJobIds,
    });
    expect(plan.attachmentJobIds).toEqual(['job-da-mensagem']);
  });

  it('reenvio não consome o composer', () => {
    // O rascunho e os arquivos embaixo são da próxima mensagem, não desta.
    const plan = planSend({
      branch: { messageId: 'msg_42', attachments: [] },
      composerJobIds,
    });
    expect(plan.clearsComposer).toBe(false);
  });

  it('escapa o id no caminho da URL', () => {
    const plan = planSend({
      branch: { messageId: 'a/b?c#d', attachments: [] },
      composerJobIds: [],
    });
    expect(plan.endpoint).toBe('/api/chat/messages/a%2Fb%3Fc%23d/versions');
  });

  it('não devolve a mesma referência da lista do composer', () => {
    const plan = planSend({ composerJobIds });
    expect(plan.attachmentJobIds).not.toBe(composerJobIds);
  });
});

describe('truncateTrailFrom', () => {
  const trail = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('remove o ponto de ramificação e tudo que veio depois dele', () => {
    // A versão nova nasce IRMÃ de `b`, não filha: `b` não pertence à trilha
    // nova e não pode continuar na tela ao lado dela.
    expect(truncateTrailFrom(trail, 'b').map((message) => message.id)).toEqual(['a']);
  });

  it('versionar a primeira mensagem esvazia a trilha exibida', () => {
    expect(truncateTrailFrom(trail, 'a')).toEqual([]);
  });

  it('id desconhecido preserva a conversa inteira', () => {
    // Um ponteiro velho não pode apagar a conversa do usuário da tela.
    expect(truncateTrailFrom(trail, 'inexistente').map((message) => message.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('não muta a lista recebida', () => {
    truncateTrailFrom(trail, 'b');
    expect(trail.map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
