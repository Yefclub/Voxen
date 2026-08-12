import { describe, expect, it } from 'bun:test';
import type {
  CompletedMemoryTurn,
  MemoryCandidate,
  MemoryProvider,
  MemorySearchInput,
} from './memory-provider';
import { runMemoryShadowEvaluation, type MemoryEvaluationCase } from './memory-evaluation';

class EvaluationProvider implements MemoryProvider {
  readonly kind = 'mem0-shadow' as const;
  private readonly turns = new Map<string, CompletedMemoryTurn[]>();

  async addCompletedTurn(turn: CompletedMemoryTurn): Promise<void> {
    this.turns.set(turn.userId, [...(this.turns.get(turn.userId) ?? []), turn]);
  }

  async search(input: MemorySearchInput): Promise<MemoryCandidate[]> {
    return (this.turns.get(input.userId) ?? [])
      .filter((turn) => turn.userContent.includes(input.query))
      .map((turn) => ({
        id: turn.userMessageId,
        content: turn.userContent,
        score: 1,
        trust: 'unverified' as const,
        provenance: {
          conversationId: turn.conversationId,
          userMessageId: turn.userMessageId,
          assistantMessageId: turn.assistantMessageId,
          algorithmVersion: 'test',
        },
        scoreDetails: null,
      }));
  }

  async deleteUser(userId: string): Promise<void> {
    this.turns.delete(userId);
  }
}

const cases: MemoryEvaluationCase[] = [
  {
    id: 'preference-pt',
    userId: 'evaluation-user-a',
    userContent: 'prefiro respostas curtas',
    assistantContent: 'Entendido.',
    query: 'respostas curtas',
    expectedTerms: ['respostas curtas'],
  },
  {
    id: 'preference-en',
    userId: 'evaluation-user-b',
    userContent: 'I prefer dark interfaces',
    assistantContent: 'Understood.',
    query: 'dark interfaces',
    expectedTerms: ['dark interfaces'],
  },
];

describe('memory shadow evaluation', () => {
  it('measures feature-off baseline, provenance recall, isolation, and deletion', async () => {
    const report = await runMemoryShadowEvaluation({
      provider: new EvaluationProvider(),
      cases,
      runId: 'deterministic-test',
      now: new Date('2026-08-11T12:00:00.000Z'),
      operatorReportedCostUsd: 0.01,
    });
    expect(report.featureOffBaseline).toMatchObject({ recall: 0, candidateTokens: 0 });
    expect(report.shadow).toMatchObject({
      recall: 1,
      provenanceRecall: 1,
      contradictionRate: 0,
      precision: 1,
      falseMemoryRate: 0,
      crossUserLeaks: 0,
      deletionResidues: 0,
      operatorReportedCostUsd: 0.01,
    });
    expect(report.passed).toBe(true);
    expect(report.decision).toBe('eligible-for-controlled-review');
  });

  it('refuses to evaluate disabled mode', async () => {
    const disabled: MemoryProvider = {
      kind: 'disabled',
      addCompletedTurn: async () => undefined,
      search: async () => [],
      deleteUser: async () => undefined,
    };
    await expect(
      runMemoryShadowEvaluation({ provider: disabled, cases, runId: 'disabled' }),
    ).rejects.toThrow('live shadow provider');
  });

  it('cleans every disposable user when setup fails partway through', async () => {
    const deleted: string[] = [];
    let writes = 0;
    const provider: MemoryProvider = {
      kind: 'mem0-shadow',
      addCompletedTurn: async () => {
        writes += 1;
        if (writes === 2) throw new Error('upstream setup failure');
      },
      search: async () => [],
      deleteUser: async (userId) => {
        deleted.push(userId);
      },
    };
    await expect(
      runMemoryShadowEvaluation({ provider, cases, runId: 'partial-failure' }),
    ).rejects.toThrow('upstream setup failure');
    expect(deleted.toSorted()).toEqual(['evaluation-user-a', 'evaluation-user-b']);
  });
});
