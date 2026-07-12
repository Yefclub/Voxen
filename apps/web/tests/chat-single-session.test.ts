import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  acquireChatStreamSlot,
  approveChatAction,
  clearConversation,
  getOrCreateConversation,
  releaseChatStreamSlot,
} from '../src/lib/chat/runtime';
import { db } from '../src/lib/db';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

async function clean(): Promise<void> {
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
    const approvalId = crypto.randomUUID();
    await db.chatApproval.create({
      data: {
        id: approvalId,
        userId: user.id,
        conversationId: conversation.id,
        action: 'create_note',
        payload: { title: 'Nota aprovada', content: 'Conteúdo seguro' },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const result = await approveChatAction(user.id, approvalId);
    expect(result.noteId).toBeTruthy();
    expect(await db.note.count({ where: { id: result.noteId, userId: user.id } })).toBe(1);
    await expect(approveChatAction(user.id, approvalId)).rejects.toThrow();
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
        expiresAt: new Date(Date.now() + 60_000),
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
