import { z } from 'zod';
import { db } from '../../src/lib/db';
import { claimPassageIndex } from '../../src/lib/passage-index/store';
import { executePassageIndex } from '../../src/lib/passage-index/runner';

if (process.env.NODE_ENV !== 'test' || process.env.PASSAGE_RECOVERY_FIXTURE !== '1')
  throw new Error('Test-only passage recovery fixture.');
const mode = process.argv[2];
const identity = z
  .object({
    userId: z.string().min(1).max(128),
    type: z.literal('note'),
    id: z.string().min(1).max(128),
  })
  .strict()
  .parse(JSON.parse(process.argv[3]!));
if (mode === 'claim') {
  if (!(await claimPassageIndex(identity))) throw new Error('CLAIM_FAILED');
  process.stdout.write('CLAIMED\n');
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
} else if (mode === 'execute') {
  if (!(await executePassageIndex(identity))) throw new Error('RECOVERY_FAILED');
  process.stdout.write('READY\n');
  await db.$disconnect();
} else throw new Error('INVALID_FIXTURE_MODE');
