export class ChatApprovalMutationError extends Error {
  readonly code: string;
  readonly currentRevision?: number;
  readonly currentChecksum?: string;

  constructor(
    code: string,
    message: string,
    details: { currentRevision?: number; currentChecksum?: string } = {},
  ) {
    super(message);
    this.name = 'ChatApprovalMutationError';
    this.code = code;
    this.currentRevision = details.currentRevision;
    this.currentChecksum = details.currentChecksum;
  }
}
