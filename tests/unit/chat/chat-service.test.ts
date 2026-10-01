import { beforeEach, describe, expect, it } from 'vitest';
import {
  AiUnavailableError,
  ChatMessageNotFoundError,
  QuotaExceededError,
} from '../../../src/modules/chat/domain/errors.js';
import { ChatService } from '../../../src/modules/chat/domain/services/chat-service.js';
import { Subscription } from '../../../src/modules/subscriptions/domain/entities/subscription.js';
import type { Actor } from '../../../src/shared/kernel/actor.js';
import { FixedClock } from '../../support/fixed-clock.js';
import {
  FakeAiClient,
  InMemoryChatMessageRepository,
  InMemoryQuotaLedger,
} from '../../support/in-memory-chat.js';
import { InMemorySubscriptionRepository } from '../../support/in-memory-subscription-repository.js';

const alice: Actor = { userId: 'alice', role: 'USER' };
const bob: Actor = { userId: 'bob', role: 'USER' };
const admin: Actor = { userId: 'admin', role: 'ADMIN' };

describe('ChatService', () => {
  let subscriptions: InMemorySubscriptionRepository;
  let ledger: InMemoryQuotaLedger;
  let ai: FakeAiClient;
  let messages: InMemoryChatMessageRepository;
  let clock: FixedClock;
  let service: ChatService;

  async function giveBundle(userId: string, tier: 'BASIC' | 'PRO' | 'ENTERPRISE' = 'BASIC') {
    const s = Subscription.create(
      { id: crypto.randomUUID(), userId, tier, billingCycle: 'MONTHLY', autoRenew: true },
      clock.now(),
    );
    await subscriptions.create(s, {
      amountCents: s.priceCents,
      success: true,
      failureReason: null,
    });
    return s.id;
  }

  beforeEach(() => {
    subscriptions = new InMemorySubscriptionRepository();
    ledger = new InMemoryQuotaLedger(subscriptions);
    ai = new FakeAiClient();
    messages = new InMemoryChatMessageRepository();
    clock = new FixedClock(new Date('2026-10-15T12:00:00Z'));
    service = new ChatService(ledger, ai, messages, clock);
  });

  it('answers and stores question, answer, token usage and metadata', async () => {
    const { message, reservation } = await service.ask(alice, 'What is DDD?', 'req-1');

    expect(reservation.source).toBe('FREE');
    expect(message.snapshot()).toMatchObject({
      userId: 'alice',
      question: 'What is DDD?',
      answer: 'Answer to: What is DDD?',
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      source: 'FREE',
      subscriptionId: null,
      requestId: 'req-1',
    });
    expect(messages.messages).toHaveLength(1);
  });

  it('gives 3 free messages, then refuses with typed details', async () => {
    for (let i = 0; i < 3; i += 1) await service.ask(alice, `q${i}`, `r${i}`);

    const error = await service.ask(alice, 'one more', 'r4').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError).details).toEqual({
      freeLimit: 3,
      freeUsed: 3,
      freeResetsAt: '2026-11-01T00:00:00.000Z',
      activeBundlesWithQuota: 0,
    });
    expect(ai.prompts).toHaveLength(3);
  });

  it('uses a bundle after the free quota and records which one paid', async () => {
    const bundleId = await giveBundle('alice');
    for (let i = 0; i < 3; i += 1) await service.ask(alice, `q${i}`, `r${i}`);

    const { message } = await service.ask(alice, 'paid question', 'r4');

    expect(message.snapshot()).toMatchObject({ source: 'SUBSCRIPTION', subscriptionId: bundleId });
    expect(subscriptions.rows.get(bundleId)?.usedMessages).toBe(1);
  });

  it('resets free quota in a new month', async () => {
    for (let i = 0; i < 3; i += 1) await service.ask(alice, `q${i}`, `r${i}`);
    clock.set(new Date('2026-11-01T00:00:01Z'));

    const { reservation } = await service.ask(alice, 'new month', 'r5');

    expect(reservation).toEqual({ source: 'FREE', period: '2026-11' });
  });

  it('refunds the reserved message when the AI fails', async () => {
    ai.failing = true;

    await expect(service.ask(alice, 'hello', 'r1')).rejects.toThrow(AiUnavailableError);

    const usage = await service.usage(alice);
    expect(usage.freeUsed).toBe(0);
    expect(messages.messages).toHaveLength(0);
  });

  it('refunds a bundle message when storing the answer fails', async () => {
    const bundleId = await giveBundle('alice');
    for (let i = 0; i < 3; i += 1) await service.ask(alice, `q${i}`, `r${i}`);
    messages.save = async () => {
      throw new Error('Database unavailable');
    };

    await expect(service.ask(alice, 'paid', 'r4')).rejects.toThrow('Database unavailable');

    expect(subscriptions.rows.get(bundleId)?.usedMessages).toBe(0);
  });

  it("hides another user's message as not found (domain policy)", async () => {
    const { message } = await service.ask(alice, 'private', 'r1');
    await expect(service.get(bob, message.id)).rejects.toThrow(ChatMessageNotFoundError);
    await expect(service.get(admin, message.id)).resolves.toBeDefined();
  });

  it('lists only the caller’s messages, admins see all', async () => {
    await service.ask(alice, 'a', 'r1');
    await service.ask(bob, 'b', 'r2');

    expect(await service.list(alice, 20)).toHaveLength(1);
    expect(await service.list(admin, 20)).toHaveLength(2);
  });
});
