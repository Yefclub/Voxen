import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { recordCompletedTurnInMemoryShadow } from '../memory/memory-provider';
import { scheduleUserMemoryShadowWrite } from '../memory/memory-shadow-coordinator';

/**
 * Persists an assistant reply on the active conversation trail. This is used
 * only when the caller did not pre-create the turn atomically.
 */
export async function createTrailedAssistant(
  conversationId: string,
  parentId: string | null,
  data: { content: string; tools?: Prisma.InputJsonValue; segments?: Prisma.InputJsonValue },
): Promise<{ id: string }> {
  const assistant = await db.chatMessage.create({
    data: { conversationId, role: 'ASSISTANT', parentId, ...data },
    select: { id: true },
  });
  // Do not swallow this failure: otherwise the response disappears from the
  // active conversation trail even though its row was persisted.
  await db.conversation.update({
    where: { id: conversationId },
    data: { activeLeafId: assistant.id },
  });
  return assistant;
}

export function scheduleCompletedTurnMemoryShadow(input: {
  userId: string;
  conversationId: string;
  userMessageId: string | null;
  assistantMessageId: string;
  assistantContent: string;
  eligible: boolean;
}): void {
  if (!input.eligible || !input.userMessageId) return;
  // Reload the canonical row instead of trusting runtime input: HITL resumes
  // use synthetic prompts and must never become user memory.
  scheduleUserMemoryShadowWrite(input.userId, async () => {
    const userMessage = await db.chatMessage.findFirst({
      where: {
        id: input.userMessageId ?? undefined,
        conversationId: input.conversationId,
        role: 'USER',
        kind: 'NORMAL',
      },
      select: { id: true, content: true },
    });
    if (!userMessage) return;
    await recordCompletedTurnInMemoryShadow({
      userId: input.userId,
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
      assistantMessageId: input.assistantMessageId,
      userContent: userMessage.content,
      assistantContent: input.assistantContent,
      completedAt: new Date(),
    });
  });
}
