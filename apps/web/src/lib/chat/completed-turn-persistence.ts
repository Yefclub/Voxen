import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';

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
