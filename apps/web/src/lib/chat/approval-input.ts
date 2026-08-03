import { z } from 'zod';

export const ApprovalBody = z.object({
  approvalId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0),
  /** Quando true, grava always-allow para a ação e confirma a pendência. */
  alwaysAllow: z.boolean().optional(),
});
