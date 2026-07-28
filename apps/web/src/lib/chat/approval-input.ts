import { z } from 'zod';

export const ApprovalBody = z.object({
  approvalId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0),
});
