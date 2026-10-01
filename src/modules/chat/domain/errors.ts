import { DomainError, NotFoundError } from '../../../shared/errors/index.js';

export interface QuotaExceededDetails {
  readonly freeLimit: number;
  readonly freeUsed: number;
  readonly freeResetsAt: string;
  readonly activeBundlesWithQuota: number;
}

export class QuotaExceededError extends DomainError {
  override readonly code = 'QUOTA_EXCEEDED';
  constructor(details: QuotaExceededDetails) {
    super(
      'No messages left. Free messages reset monthly; add a subscription bundle to continue now.',
      { ...details },
    );
  }
}

export class ChatMessageNotFoundError extends NotFoundError {
  constructor() {
    super('Chat message not found.');
  }
}

export class AiUnavailableError extends DomainError {
  override readonly code = 'AI_UNAVAILABLE';
  constructor() {
    super('The AI service is temporarily unavailable. No quota was used.');
  }
}
