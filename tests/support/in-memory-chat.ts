import type { ChatMessage } from '../../src/modules/chat/domain/entities/chat-message.js';
import {
  periodKey,
  selectQuotaSource,
  type QuotaBundle,
  type QuotaReservation,
} from '../../src/modules/chat/domain/entities/quota.js';
import type {
  AiClient,
  AiCompletion,
  ChatMessageRepository,
  QuotaLedger,
  UsageSummary,
} from '../../src/modules/chat/domain/ports.js';
import type { InMemorySubscriptionRepository } from './in-memory-subscription-repository.js';

/**
 * In-memory ledger applying the same quota rule as the database (selectQuotaSource).
 * Reads bundles from the in-memory subscription store, like the real ledger reads
 * the Subscription table. Concurrency safety is proven separately against Postgres.
 */
export class InMemoryQuotaLedger implements QuotaLedger {
  readonly freeUsed = new Map<string, number>();

  constructor(private readonly subscriptions: InMemorySubscriptionRepository) {}

  private bundlesOf(userId: string): (QuotaBundle & { tier: string })[] {
    return [...this.subscriptions.rows.values()].filter((r) => r.userId === userId);
  }

  async reserve(userId: string, now: Date): Promise<QuotaReservation | null> {
    const key = `${userId}:${periodKey(now)}`;
    const reservation = selectQuotaSource(this.freeUsed.get(key) ?? 0, this.bundlesOf(userId), now);
    if (!reservation) return null;

    if (reservation.source === 'FREE') {
      this.freeUsed.set(key, (this.freeUsed.get(key) ?? 0) + 1);
    } else {
      const row = this.subscriptions.rows.get(reservation.subscriptionId)!;
      this.subscriptions.setUsedMessages(row.id, row.usedMessages + 1);
    }
    return reservation;
  }

  async release(userId: string, reservation: QuotaReservation): Promise<void> {
    if (reservation.source === 'FREE') {
      const key = `${userId}:${reservation.period}`;
      this.freeUsed.set(key, Math.max(0, (this.freeUsed.get(key) ?? 0) - 1));
    } else {
      const row = this.subscriptions.rows.get(reservation.subscriptionId);
      if (row) this.subscriptions.setUsedMessages(row.id, Math.max(0, row.usedMessages - 1));
    }
  }

  async usage(userId: string, now: Date): Promise<UsageSummary> {
    return {
      period: periodKey(now),
      freeUsed: this.freeUsed.get(`${userId}:${periodKey(now)}`) ?? 0,
      bundles: this.bundlesOf(userId)
        .filter((b) => b.status === 'ACTIVE' && b.startDate <= now && now < b.endDate)
        .map((b) => ({
          subscriptionId: b.id,
          tier: b.tier,
          remaining: b.maxMessages === null ? null : Math.max(0, b.maxMessages - b.usedMessages),
          endDate: b.endDate,
        })),
    };
  }
}

export class InMemoryChatMessageRepository implements ChatMessageRepository {
  readonly messages: ChatMessage[] = [];

  async save(message: ChatMessage): Promise<void> {
    this.messages.push(message);
  }
  async findById(id: string): Promise<ChatMessage | null> {
    return this.messages.find((m) => m.id === id) ?? null;
  }
  async listByUser(userId: string, limit: number): Promise<ChatMessage[]> {
    return this.messages
      .filter((m) => m.userId === userId)
      .slice(-limit)
      .reverse();
  }
  async listAll(limit: number): Promise<ChatMessage[]> {
    return this.messages.slice(-limit).reverse();
  }
}

/** AI client with a fixed answer that can be told to fail. */
export class FakeAiClient implements AiClient {
  readonly prompts: string[] = [];
  failing = false;

  async complete(prompt: string): Promise<AiCompletion> {
    this.prompts.push(prompt);
    if (this.failing) throw new Error('Upstream AI error');
    return {
      answer: `Answer to: ${prompt}`,
      model: 'fake-model',
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    };
  }
}
