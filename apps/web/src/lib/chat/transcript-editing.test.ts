import { describe, expect, test } from 'bun:test';
import { HITL_ACTION_PATCH_TRANSCRIPT } from './hitl-policy';
import {
  chatTranscriptPatchApprovalProof,
  extractTranscriptApprovalPayload,
  extractTranscriptPatchProposal,
  type ChatTranscriptPatchProposal,
} from './transcript-editing';

const proposal: ChatTranscriptPatchProposal = {
  action: HITL_ACTION_PATCH_TRANSCRIPT,
  transcriptId: 'transcript-1',
  transcriptTitle: 'Interview',
  expectedRevision: 2,
  expectedSourceVersion: 4,
  expectedSourceChecksum: 'source-checksum',
  expectedBaseChecksum: 'a'.repeat(64),
  operation: { kind: 'replace', target: 'teh', text: 'the', occurrence: 2 },
  changeSummary: 'Fix transcription typo',
};

describe('transcript correction approval payload', () => {
  test('requires complete source identity before creating a proposal', () => {
    expect(extractTranscriptPatchProposal(proposal)).toEqual(proposal);
    expect(extractTranscriptPatchProposal({ ...proposal, expectedBaseChecksum: '' })).toBeNull();
    expect(extractTranscriptPatchProposal({ ...proposal, expectedSourceVersion: -1 })).toBeNull();
  });

  test('proof changes with the revision, source, operation, or result', () => {
    const proof = chatTranscriptPatchApprovalProof(proposal, 'Interview', 'b'.repeat(64));
    expect(proof).toHaveLength(64);
    expect(
      chatTranscriptPatchApprovalProof(
        { ...proposal, expectedRevision: proposal.expectedRevision + 1 },
        'Interview',
        'b'.repeat(64),
      ),
    ).not.toBe(proof);
    expect(chatTranscriptPatchApprovalProof(proposal, 'Interview', 'c'.repeat(64))).not.toBe(proof);
  });

  test('rejects persisted approvals without a validated preview proof', () => {
    const preview = {
      operationKind: 'replace',
      occurrence: 2,
      changeSummary: proposal.changeSummary,
      target: 'teh',
      replacement: 'the',
      line: 12,
      context: 'the context',
      resultingChecksum: 'b'.repeat(64),
      truncatedTarget: false,
      truncatedReplacement: false,
      truncatedContext: false,
    };
    expect(extractTranscriptApprovalPayload({ ...proposal, patchPreview: preview })).toBeNull();
    expect(
      extractTranscriptApprovalPayload({
        ...proposal,
        patchPreview: preview,
        previewProof: chatTranscriptPatchApprovalProof(
          proposal,
          proposal.transcriptTitle,
          preview.resultingChecksum,
        ),
      }),
    ).not.toBeNull();
  });
});
