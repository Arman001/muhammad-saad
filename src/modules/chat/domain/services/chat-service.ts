import { randomUUID } from 'node:crypto';
import { isAdmin, type Actor } from '../../../../shared/kernel/actor.js';
import type { Clock } from '../../../../shared/kernel/clock.js';
import { ChatMessage } from '../entities/chat-message.js';
import {
  FREE_MESSAGES_PER_MONTH,
  nextPeriodStart,
  type QuotaReservation,
} from '../entities/quota.js';
import { AiUnavailableError, ChatMessageNotFoundError, QuotaExceededError } from '../errors.js';
import { canViewChatMessage } from '../policies/chat-policy.js';
import type { AiClient, ChatMessageRepository, QuotaLedger, UsageSummary } from '../ports.js';

export interface AskResult {
  readonly message: ChatMessage;
  readonly reservation: QuotaReservation;
}

/** Use cases for the AI chat. */
export class ChatService {
  constructor(
    private readonly ledger: QuotaLedger,
    private readonly ai: AiClient,
    private readonly messages: ChatMessageRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * 1. Reserve one message of quota (atomic, in its own short transaction).
   * 2. Ask the model, outside any transaction, so slow AI calls never hold locks.
   * 3. Store the result. If anything after the reservation fails, the message is refunded.
   */
  async ask(actor: Actor, question: string, requestId: string): Promise<AskResult> {
    const now = this.clock.now();
    const reservation = await this.ledger.reserve(actor.userId, now);
    if (!reservation) {
      throw await this.quotaExceeded(actor.userId, now);
    }

    try {
      let completion;
      try {
        completion = await this.ai.complete(question);
      } catch {
        throw new AiUnavailableError();
      }

      const message = ChatMessage.create({
        id: randomUUID(),
        userId: actor.userId,
        question,
        answer: completion.answer,
        usage: completion.usage,
        source: reservation.source,
        subscriptionId: reservation.source === 'SUBSCRIPTION' ? reservation.subscriptionId : null,
        requestId,
        createdAt: this.clock.now(),
      });
      await this.messages.save(message);
      return { message, reservation };
    } catch (error) {
      await this.ledger.release(actor.userId, reservation);
      throw error;
    }
  }

  async list(actor: Actor, limit: number): Promise<ChatMessage[]> {
    return isAdmin(actor)
      ? this.messages.listAll(limit)
      : this.messages.listByUser(actor.userId, limit);
  }

  async get(actor: Actor, id: string): Promise<ChatMessage> {
    const message = await this.messages.findById(id);
    if (!message || !canViewChatMessage(actor, message)) {
      throw new ChatMessageNotFoundError();
    }
    return message;
  }

  async usage(actor: Actor): Promise<UsageSummary & { freeLimit: number; freeResetsAt: Date }> {
    const now = this.clock.now();
    const summary = await this.ledger.usage(actor.userId, now);
    return { ...summary, freeLimit: FREE_MESSAGES_PER_MONTH, freeResetsAt: nextPeriodStart(now) };
  }

  private async quotaExceeded(userId: string, now: Date): Promise<QuotaExceededError> {
    const summary = await this.ledger.usage(userId, now);
    return new QuotaExceededError({
      freeLimit: FREE_MESSAGES_PER_MONTH,
      freeUsed: summary.freeUsed,
      freeResetsAt: nextPeriodStart(now).toISOString(),
      activeBundlesWithQuota: summary.bundles.filter((b) => b.remaining === null || b.remaining > 0)
        .length,
    });
  }
}
