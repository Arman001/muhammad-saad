import type { ChatMessage, TokenUsage } from './entities/chat-message.js';
import type { QuotaReservation } from './entities/quota.js';

export interface AiCompletion {
  readonly answer: string;
  readonly model: string;
  readonly usage: TokenUsage;
}

/** The language model. Mocked in this project, OpenAI-shaped. */
export interface AiClient {
  complete(prompt: string): Promise<AiCompletion>;
}

export interface BundleUsage {
  readonly subscriptionId: string;
  readonly tier: string;
  /** null means unlimited. */
  readonly remaining: number | null;
  readonly endDate: Date;
}

export interface UsageSummary {
  readonly period: string;
  readonly freeUsed: number;
  readonly bundles: readonly BundleUsage[];
}

/**
 * Atomic quota accounting. Implementations must be safe under concurrent
 * requests: two requests can never both take the last available message.
 */
export interface QuotaLedger {
  /** Takes one message of quota following the quota rule, or returns null if none is left. */
  reserve(userId: string, now: Date): Promise<QuotaReservation | null>;
  /** Gives a reserved message back (used when answering fails). */
  release(userId: string, reservation: QuotaReservation): Promise<void>;
  usage(userId: string, now: Date): Promise<UsageSummary>;
}

export interface ChatMessageRepository {
  save(message: ChatMessage): Promise<void>;
  findById(id: string): Promise<ChatMessage | null>;
  listByUser(userId: string, limit: number): Promise<ChatMessage[]>;
  listAll(limit: number): Promise<ChatMessage[]>;
}
