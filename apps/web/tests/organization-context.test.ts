import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { deleteUserSettings, setUserSetting } from '../src/lib/settings';
import { prepareOrganization } from '../src/lib/organization/context';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('organization Standard role execution snapshot', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `organization-context-${randomUUID()}@example.test`,
              name: 'Organization model',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { userId: { in: users }, scope: 'USER' } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  test('requires the current owner model credentials and does not require web discovery', async () => {
    await expect(prepareOrganization(users[0]!, null)).rejects.toThrow('No AI model is configured');
    await setUserSetting(users[0]!, 'ai_provider_key:anthropic', 'fixture-organization-key');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({
        chains: { standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] },
        reasoning: { standard: 'high' },
      }),
    );
    expect((await prepareOrganization(users[0]!, null)).execution).toMatchObject({
      reasoning: 'high',
      chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
    });
    await setUserSetting(
      users[1]!,
      'ai_model_chains',
      JSON.stringify({
        chains: { standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] },
      }),
    );
    await expect(prepareOrganization(users[1]!, null)).rejects.toThrow('No AI model is configured');
  });
  test('freezes model identifiers and reasoning while resolving fresh owned credentials', async () => {
    const first = await prepareOrganization(users[0]!, null);
    expect(JSON.stringify(first.execution)).not.toContain('fixture-organization-key');
    await setUserSetting(users[0]!, 'ai_provider_key:google', 'fixture-google-key');
    await setUserSetting(
      users[0]!,
      'ai_model_chains',
      JSON.stringify({
        chains: { standard: [{ provider: 'google', model: 'gemini-3.5-flash-lite' }] },
        reasoning: { standard: 'off' },
      }),
    );
    expect((await prepareOrganization(users[0]!, first.execution)).execution).toEqual(
      first.execution,
    );
    await deleteUserSettings(users[0]!, ['ai_provider_key:anthropic']);
    await expect(prepareOrganization(users[0]!, first.execution)).rejects.toThrow(
      'No AI model is configured',
    );
  });
});
