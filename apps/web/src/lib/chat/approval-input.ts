import { z } from 'zod';

export const ApprovalBody = z.object({
  approvalId: z.string().trim().min(1).max(200),
});
