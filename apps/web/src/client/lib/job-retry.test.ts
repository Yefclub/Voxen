import { expect, test } from 'bun:test';
import { canRetryJob } from './job-retry';

test('permite repetir somente os enriquecimentos de um job concluído com pendências', () => {
  expect(canRetryJob('COMPLETED_WITH_WARNINGS')).toBe(true);
  expect(canRetryJob('DONE')).toBe(false);
  expect(canRetryJob('RUNNING')).toBe(false);
});
