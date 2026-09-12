import { tool } from 'ai';
import { z } from 'zod';
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import {
  enqueueKnowledgeDeletionInTransaction,
  KnowledgeDeletionConflictError,
  KnowledgeDeletionNotFoundError,
  resolveKnowledgeDeletionTarget,
} from '../knowledge-deletion';
import { HITL_ACTION_DELETE_KNOWLEDGE } from './hitl-policy';

const chatKnowledgeDeletionSchema = z.object({
  action: z.literal(HITL_ACTION_DELETE_KNOWLEDGE),
  targetType: z.enum([
    'TRANSCRIPT',
    'NOTE',
    'SAVED_MEDIA',
    'LIBRARY_FOLDER',
    'TRANSCRIPT_ENRICHMENT',
  ]),
  targetId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
});

export type ChatKnowledgeDeletionApprovalPayload = z.infer<typeof chatKnowledgeDeletionSchema>;

export function extractKnowledgeDeletionPayload(
  value: Record<string, unknown>,
): ChatKnowledgeDeletionApprovalPayload | null {
  const parsed = chatKnowledgeDeletionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function prepareChatKnowledgeDeletionApproval(
  userId: string,
  input: Record<string, unknown>,
): Promise<ChatKnowledgeDeletionApprovalPayload> {
  const candidate = extractKnowledgeDeletionPayload({
    ...input,
    action: HITL_ACTION_DELETE_KNOWLEDGE,
  });
  if (!candidate) throw new Error('Proposta de exclusão inválida.');
  const target = await resolveKnowledgeDeletionTarget(
    userId,
    candidate.targetType,
    candidate.targetId,
  );
  if (!target) throw new KnowledgeDeletionNotFoundError('Conteúdo não encontrado.');
  return {
    action: HITL_ACTION_DELETE_KNOWLEDGE,
    targetType: candidate.targetType,
    targetId: target.id,
    title: target.title,
  };
}

export function createListDeletableKnowledgeTool(userId: string) {
  return tool({
    description:
      'Localiza alvos que podem ser excluídos no workspace atual e retorna os IDs e títulos ' +
      'canônicos necessários para uma confirmação segura. Use antes de propor qualquer exclusão.',
    inputSchema: z.object({
      query: z.string().trim().max(300).optional(),
      targetType: z
        .enum(['TRANSCRIPT', 'NOTE', 'SAVED_MEDIA', 'LIBRARY_FOLDER', 'TRANSCRIPT_ENRICHMENT'])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ query, targetType, limit }) => {
      const take = limit ?? 20;
      const perTypeTake = targetType ? take : Math.min(take, 10);
      const titleFilter = query?.trim()
        ? { contains: query.trim(), mode: 'insensitive' as const }
        : undefined;
      const results: Array<{
        targetType: ChatKnowledgeDeletionApprovalPayload['targetType'];
        targetId: string;
        title: string;
        kind?: string;
      }> = [];
      if (!targetType || targetType === 'TRANSCRIPT') {
        const rows = await db.transcript.findMany({
          where: { userId, ...(titleFilter ? { title: titleFilter } : {}) },
          orderBy: { updatedAt: 'desc' },
          take: perTypeTake,
          select: { id: true, title: true, status: true },
        });
        results.push(
          ...rows.map((row) => ({
            targetType: 'TRANSCRIPT' as const,
            targetId: row.id,
            title: row.title,
            kind: row.status,
          })),
        );
      }
      if (!targetType || targetType === 'NOTE') {
        const rows = await db.note.findMany({
          where: { userId, ...(titleFilter ? { title: titleFilter } : {}) },
          orderBy: { updatedAt: 'desc' },
          take: perTypeTake,
          select: { id: true, title: true, kind: true },
        });
        results.push(
          ...rows.map((row) => ({
            targetType: 'NOTE' as const,
            targetId: row.id,
            title: row.title,
            kind: row.kind,
          })),
        );
      }
      if (!targetType || targetType === 'SAVED_MEDIA') {
        const rows = await db.savedMedia.findMany({
          where: {
            userId,
            transcriptId: null,
            status: { in: ['READY', 'FAILED'] },
            ...(query?.trim()
              ? {
                  OR: [
                    { title: titleFilter },
                    { sourceUrl: { contains: query.trim(), mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: perTypeTake,
          select: { id: true, title: true, sourceUrl: true, status: true },
        });
        results.push(
          ...rows.map((row) => ({
            targetType: 'SAVED_MEDIA' as const,
            targetId: row.id,
            title: row.title?.trim() || row.sourceUrl,
            kind: row.status,
          })),
        );
      }
      if (!targetType || targetType === 'LIBRARY_FOLDER') {
        const rows = await db.libraryFolder.findMany({
          where: { userId, ...(titleFilter ? { name: titleFilter } : {}) },
          orderBy: { updatedAt: 'desc' },
          take: perTypeTake,
          select: { id: true, name: true },
        });
        results.push(
          ...rows.map((row) => ({
            targetType: 'LIBRARY_FOLDER' as const,
            targetId: row.id,
            title: row.name,
          })),
        );
      }
      if (!targetType || targetType === 'TRANSCRIPT_ENRICHMENT') {
        const rows = await db.transcriptEnrichment.findMany({
          where: {
            userId,
            status: { notIn: ['PENDING', 'RUNNING', 'RETRY'] },
            ...(titleFilter ? { title: titleFilter } : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: perTypeTake,
          select: { id: true, title: true, status: true },
        });
        results.push(
          ...rows.map((row) => ({
            targetType: 'TRANSCRIPT_ENRICHMENT' as const,
            targetId: row.id,
            title: row.title,
            kind: row.status,
          })),
        );
      }
      return { results, count: results.length };
    },
  });
}

export function createProposeKnowledgeDeletionTool() {
  return tool({
    description:
      'Propõe excluir permanentemente um conteúdo que o usuário pediu para apagar. ' +
      'Use somente depois de localizar o alvo exato. A interface sempre exige confirmação humana.',
    inputSchema: z.object({
      targetType: z.enum([
        'TRANSCRIPT',
        'NOTE',
        'SAVED_MEDIA',
        'LIBRARY_FOLDER',
        'TRANSCRIPT_ENRICHMENT',
      ]),
      targetId: z.string().min(1).max(200),
      title: z.string().min(1).max(500),
    }),
    execute: async ({ targetType, targetId, title }) => ({
      handledBy: 'ui_approve',
      targetType,
      targetId,
      title,
    }),
  });
}

export async function applyApprovedKnowledgeDeletionMutation(
  tx: Prisma.TransactionClient,
  userId: string,
  payload: ChatKnowledgeDeletionApprovalPayload,
): Promise<{
  resource: { id: string; title: string };
  resourceKind: 'knowledge';
  jobId: string;
  jobCreated: boolean;
  outcomeMessage: string;
  systemMessage: string;
}> {
  try {
    const result = await enqueueKnowledgeDeletionInTransaction(tx, {
      userId,
      type: payload.targetType,
      id: payload.targetId,
      expectedTitle: payload.title,
    });
    return {
      resource: { id: result.target.id, title: result.target.title },
      resourceKind: 'knowledge',
      jobId: result.job.id,
      jobCreated: result.created,
      outcomeMessage: `A exclusão de “${result.target.title}” foi adicionada à fila.`,
      systemMessage: `A exclusão permanente de “${result.target.title}” foi confirmada e adicionada à fila.`,
    };
  } catch (error) {
    if (
      error instanceof KnowledgeDeletionNotFoundError ||
      error instanceof KnowledgeDeletionConflictError
    ) {
      throw new Error(error.message);
    }
    throw error;
  }
}
