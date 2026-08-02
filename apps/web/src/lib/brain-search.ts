import { db } from './db';

type BrainSearchDb = Pick<typeof db, 'brainNode'>;

export async function searchBrainNodes(
  userId: string,
  query: string,
  limit: number,
  client: BrainSearchDb = db,
) {
  return client.brainNode.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      OR: [
        { key: { contains: query, mode: 'insensitive' } },
        { label: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      key: true,
      type: true,
      label: true,
      description: true,
      status: true,
      sourceType: true,
      sourceId: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
