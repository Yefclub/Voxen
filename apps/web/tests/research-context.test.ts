import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { setUserSetting, deleteUserSettings } from '../src/lib/settings';
import { prepareResearch } from '../src/lib/research/context';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('research model snapshot and credential preflight', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `research-context-${randomUUID()}@example.test`,
              name: 'Research model context',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  test('requires discovery and text credentials from the same owner before paid work', async () => {
    await expect(prepareResearch(users[0]!, null)).rejects.toThrow('WEB_NOT_CONFIGURED');
    await setUserSetting(users[0]!, 'assistant_search_key', 'fixture-discovery-key');
    await expect(prepareResearch(users[0]!, null)).rejects.toThrow('No AI model is configured');
    await setUserSetting(users[0]!, 'ai_provider_key:anthropic', 'fixture-provider-key');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({
        chains: { standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] },
        reasoning: { standard: 'high' },
      }),
    );
    await setUserSetting(users[1]!, 'assistant_search_key', 'fixture-second-discovery-key');
    await setUserSetting(
      users[1]!,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await expect(prepareResearch(users[1]!, null)).rejects.toThrow('No AI model is configured');
  });
  test('preserves the first model snapshot across retries without persisting keys', async () => {
    const first = await prepareResearch(users[0]!, null);
    expect(first.execution).toMatchObject({
      reasoning: 'high',
      chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
    });
    expect(JSON.stringify(first.execution)).not.toContain('fixture-provider-key');
    expect(JSON.stringify(first.execution)).not.toContain('fixture-discovery-key');
    await setUserSetting(users[0]!, 'ai_provider_key:google', 'fixture-google-key');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({
        chains: { standard: [{ provider: 'google', model: 'gemini-3.5-flash-lite' }] },
        reasoning: { standard: 'off' },
      }),
    );
    expect((await prepareResearch(users[0]!, first.execution)).execution).toEqual(first.execution);
    await deleteUserSettings(users[0]!, ['ai_provider_key:anthropic']);
    await expect(prepareResearch(users[0]!, first.execution)).rejects.toThrow(
      'No AI model is configured',
    );
  });
});
