import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  acquireChatStreamSlot,
  approveChatAction,
  clearConversation,
  getOrCreateConversation,
  getChatSnapshot,
  releaseChatStreamSlot,
} from '../src/lib/chat/runtime';
import { db } from '../src/lib/db';
import {
  ChatTurnBusyError,
  createChatTurn,
  recoverOrphanedUserTurn,
} from '../src/lib/chat/turn-runtime';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

async function clean(): Promise<void> {
  await db.chatTurn.deleteMany();
  await db.chatStreamLease.deleteMany();
  await db.chatCompactionLease.deleteMany();
  await db.chatApproval.deleteMany();
  await db.chatMessage.deleteMany();
  await db.conversation.deleteMany();
  await db.note.deleteMany({ where: { user: { email: { startsWith: 'chat-test-' } } } });
  await db.user.deleteMany({ where: { email: { startsWith: 'chat-test-' } } });
}

describeIfDb('chat de sessão única', () => {
  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  it('reutiliza a mesma conversa canônica sob chamadas concorrentes', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-one@voxen.local', name: 'Chat Teste', status: 'APPROVED' },
    });
    const [first, second] = await Promise.all([
      getOrCreateConversation(user.id),
      getOrCreateConversation(user.id),
    ]);
    expect(first.id).toBe(second.id);
    expect(await db.conversation.count({ where: { userId: user.id } })).toBe(1);
  });

  it('mantém conversas isoladas entre usuários', async () => {
    const [firstUser, secondUser] = await Promise.all([
      db.user.create({ data: { email: 'chat-test-a@voxen.local', name: 'A', status: 'APPROVED' } }),
      db.user.create({ data: { email: 'chat-test-b@voxen.local', name: 'B', status: 'APPROVED' } }),
    ]);
    const [first, second] = await Promise.all([
      getOrCreateConversation(firstUser.id),
      getOrCreateConversation(secondUser.id),
    ]);
    expect(first.id).not.toBe(second.id);
  });

  it('restaura raciocínio e ferramentas persistidos no snapshot', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-segments@voxen.local', name: 'Segments', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const segments = [
      { type: 'reasoning', id: 'r0', text: 'Vou consultar', startedAt: 10, endedAt: 20 },
      {
        type: 'tool-group',
        id: 'g0',
        tools: [{ id: 't0', name: 'search_transcripts', state: 'completed' }],
      },
    ];
    await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: 'Resposta',
        tools: segments[1]?.tools,
        segments,
      },
    });
    const snapshot = await getChatSnapshot(user.id);
    expect(snapshot.messages[0]?.segments).toEqual(segments);
  });

  it('pagina apenas mensagens ativas e mantém ordem estável', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-pages@voxen.local', name: 'Pages', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    await db.chatMessage.createMany({
      data: Array.from({ length: 125 }, (_, index) => ({
        conversationId: conversation.id,
        role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
        content: `mensagem ${String(index).padStart(3, '0')}`,
        compactedAt: index < 5 ? new Date() : null,
      })),
    });

    const first = await getChatSnapshot(user.id);
    expect(first.messages).toHaveLength(60);
    expect(first.hasOlder).toBe(true);
    expect(first.nextCursor).toBe(first.messages[0]!.id);
    expect(first.messages.every((message) => message.compactedAt === null)).toBe(true);

    const second = await getChatSnapshot(user.id, { before: first.nextCursor!, limit: 60 });
    expect(second.messages).toHaveLength(60);
    expect(second.hasOlder).toBe(false);
    expect(new Set([...first.messages, ...second.messages].map((message) => message.id)).size).toBe(
      120,
    );
  });

  it('persiste o turno completo antes de processar e bloqueia concorrência', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-turn@voxen.local', name: 'Turn', status: 'APPROVED' },
    });
    const turn = await createChatTurn(user.id, 'Analise este link');
    expect(turn.status).toBe('PENDING');
    expect(await db.chatMessage.count({ where: { id: turn.userMessageId, role: 'USER' } })).toBe(1);
    expect(
      await db.chatMessage.count({ where: { id: turn.assistantMessageId, role: 'ASSISTANT' } }),
    ).toBe(1);
    await expect(createChatTurn(user.id, 'Segundo envio')).rejects.toBeInstanceOf(
      ChatTurnBusyError,
    );
  });

  it('recupera uma mensagem órfã uma única vez após restart', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-recover@voxen.local', name: 'Recover', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const message = await db.chatMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: 'Continue depois do link' },
    });

    const first = await recoverOrphanedUserTurn(user.id);
    const second = await recoverOrphanedUserTurn(user.id);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(await db.chatTurn.count({ where: { userMessageId: message.id } })).toBe(1);
    expect(
      await db.chatMessage.count({
        where: { conversationId: conversation.id, role: 'ASSISTANT', content: '' },
      }),
    ).toBe(1);
  });

  it('aceita apenas um stream ativo por usuário e libera o slot pelo dono', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-stream@voxen.local', name: 'Stream', status: 'APPROVED' },
    });
    const owner = await acquireChatStreamSlot(user.id);
    expect(owner).not.toBeNull();
    expect(await acquireChatStreamSlot(user.id)).toBeNull();
    await releaseChatStreamSlot(user.id, owner!);
    expect(await acquireChatStreamSlot(user.id)).not.toBeNull();
  });

  it('executa a aprovação uma única vez e cria a nota no workspace correto', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-approval@voxen.local', name: 'Approval', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const approvalId = 'approval:provider-tool-call_01JABCDEF';
    await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: '',
        tools: [
          {
            id: 'tool-1',
            name: 'propose_create_note',
            state: 'approval-required',
            output: {
              approvalRequired: true,
              approvalId,
              action: 'create_note',
              title: 'Nota aprovada',
            },
          },
        ],
        segments: [
          {
            type: 'tool-group',
            id: 'g0',
            tools: [
              {
                id: 'tool-1',
                name: 'propose_create_note',
                state: 'approval-required',
                output: {
                  approvalRequired: true,
                  approvalId,
                  action: 'create_note',
                  title: 'Nota aprovada',
                },
              },
            ],
          },
        ],
      },
    });
    await db.chatApproval.create({
      data: {
        id: approvalId,
        userId: user.id,
        conversationId: conversation.id,
        action: 'create_note',
        payload: { title: 'Nota aprovada', content: 'Conteúdo seguro' },
        expiresAt: null,
      },
    });
    const result = await approveChatAction(user.id, approvalId);
    expect(result.noteId).toBeTruthy();
    expect(await db.note.count({ where: { id: result.noteId, userId: user.id } })).toBe(1);
    const hitlMessage = await db.chatMessage.findFirst({
      where: { conversationId: conversation.id, kind: 'HITL_RESPONSE' },
    });
    expect(hitlMessage?.tools).toBeNull();
    const assistant = await db.chatMessage.findFirst({
      where: { conversationId: conversation.id, role: 'ASSISTANT' },
    });
    const tools = assistant?.tools as Array<{
      state: string;
      output?: { approvalRequired?: boolean };
    }>;
    expect(tools?.[0]?.state).toBe('completed');
    expect(tools?.[0]?.output?.approvalRequired).toBe(false);
    await expect(approveChatAction(user.id, approvalId)).rejects.toThrow();
  });

  it('aceita aprovação pendente mesmo com expiresAt no passado (sem TTL)', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-approval-ttl@voxen.local', name: 'TTL', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const approvalId = crypto.randomUUID();
    await db.chatApproval.create({
      data: {
        id: approvalId,
        userId: user.id,
        conversationId: conversation.id,
        action: 'create_note',
        payload: { title: 'Nota antiga', content: 'ainda válida' },
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const result = await approveChatAction(user.id, approvalId);
    expect(result.noteId).toBeTruthy();
  });

  it('resolve HITL enterrado sob muitas mensagens assistant posteriores', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-approval-deep@voxen.local', name: 'Deep', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const approvalId = crypto.randomUUID();
    const pendingMessage = await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: '',
        tools: [
          {
            id: 'tool-deep',
            name: 'propose_create_note',
            state: 'approval-required',
            output: {
              approvalRequired: true,
              approvalId,
              action: 'create_note',
              title: 'Nota antiga',
            },
          },
        ],
      },
    });
    await db.chatApproval.create({
      data: {
        id: approvalId,
        userId: user.id,
        conversationId: conversation.id,
        action: 'create_note',
        payload: { title: 'Nota antiga', content: 'ainda pendente' },
        expiresAt: null,
      },
    });
    // More than the old take:40 window of later assistant turns.
    await db.chatMessage.createMany({
      data: Array.from({ length: 45 }, (_, index) => ({
        conversationId: conversation.id,
        role: 'ASSISTANT' as const,
        content: `turno posterior ${index}`,
      })),
    });
    const result = await approveChatAction(user.id, approvalId);
    expect(result.noteId).toBeTruthy();
    const updated = await db.chatMessage.findUnique({ where: { id: pendingMessage.id } });
    const tools = updated?.tools as Array<{
      state: string;
      output?: { approvalRequired?: boolean };
    }>;
    expect(tools?.[0]?.state).toBe('completed');
    expect(tools?.[0]?.output?.approvalRequired).toBe(false);
  });

  it('revive aprovação ausente a partir do payload na mensagem assistant', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-approval-revive@voxen.local', name: 'Revive', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const approvalId = crypto.randomUUID();
    await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: 'Quer que eu confirme a criação da nota?',
        tools: [
          {
            id: 'tool-legacy',
            name: 'propose_create_note',
            state: 'approval-required',
            output: {
              approvalRequired: true,
              approvalId,
              action: 'create_note',
              title: 'Nota legado',
              content: 'conteúdo recuperado da mensagem',
            },
          },
        ],
      },
    });
    // No ChatApproval row — simulates pre-090 expiry / missing row.
    const result = await approveChatAction(user.id, approvalId);
    expect(result.noteId).toBeTruthy();
    expect(await db.note.count({ where: { id: result.noteId, userId: user.id } })).toBe(1);
    expect(await db.chatApproval.count({ where: { id: approvalId, status: 'APPROVED' } })).toBe(1);
  });

  it('snapshot descarta card fantasma de aprovação já utilizada', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-approval-ghost@voxen.local', name: 'Ghost', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    const approvalId = crypto.randomUUID();
    await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: '',
        tools: [
          {
            id: 'tool-ghost',
            name: 'propose_create_note',
            state: 'approval-required',
            output: {
              approvalRequired: true,
              approvalId,
              action: 'create_note',
              title: 'Já criada',
              content: 'x',
            },
          },
        ],
      },
    });
    await db.chatApproval.create({
      data: {
        id: approvalId,
        userId: user.id,
        conversationId: conversation.id,
        action: 'create_note',
        payload: { title: 'Já criada', content: 'x' },
        status: 'APPROVED',
        decidedAt: new Date(),
        expiresAt: null,
      },
    });
    const snapshot = await getChatSnapshot(user.id);
    const assistant = snapshot.messages.find((message) => message.role === 'ASSISTANT');
    const tools = assistant?.tools as Array<{
      state: string;
      output?: { approvalRequired?: boolean };
    }>;
    expect(tools?.[0]?.state).toBe('completed');
    expect(tools?.[0]?.output?.approvalRequired).toBe(false);
  });

  it('limpa mensagens e aprovações pendentes sem remover a conversa canônica', async () => {
    const user = await db.user.create({
      data: { email: 'chat-test-clear@voxen.local', name: 'Clear', status: 'APPROVED' },
    });
    const conversation = await getOrCreateConversation(user.id);
    await db.chatMessage.createMany({
      data: [
        { conversationId: conversation.id, role: 'USER', content: 'Oi' },
        { conversationId: conversation.id, role: 'ASSISTANT', content: 'Olá' },
      ],
    });
    await db.chatApproval.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        conversationId: conversation.id,
        action: 'create_note',
        payload: { title: 'Pendente', content: 'x' },
        expiresAt: null,
      },
    });
    await clearConversation(user.id);
    expect(await db.chatMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect(await db.chatApproval.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect(await db.conversation.count({ where: { id: conversation.id, userId: user.id } })).toBe(
      1,
    );
  });
});
