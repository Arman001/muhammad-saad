import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireActor } from '../../../shared/auth/require-actor.js';
import type { Subscription } from '../domain/entities/subscription.js';
import { BILLING_CYCLES, TIERS } from '../domain/entities/tier-catalog.js';
import type { SubscriptionService } from '../domain/services/subscription-service.js';

// Strict schemas: unknown fields are rejected, so clients cannot set things
// like status, price or userId (no mass assignment).
const CreateSubscriptionBody = z.strictObject({
  tier: z.enum(TIERS),
  billingCycle: z.enum(BILLING_CYCLES),
  autoRenew: z.boolean().default(true),
});

const UpdateSubscriptionBody = z.strictObject({
  autoRenew: z.boolean(),
});

const SubscriptionIdParams = z.strictObject({
  id: z.uuid(),
});

/** The public shape of a subscription. Internal fields are never exposed directly. */
export function toSubscriptionResponse(subscription: Subscription) {
  const s = subscription.snapshot();
  return {
    id: s.id,
    userId: s.userId,
    tier: s.tier,
    billingCycle: s.billingCycle,
    maxMessages: s.maxMessages,
    usedMessages: s.usedMessages,
    remainingMessages: subscription.remainingMessages(),
    price: (s.priceCents / 100).toFixed(2),
    currency: 'USD',
    startDate: s.startDate.toISOString(),
    endDate: s.endDate.toISOString(),
    renewalDate: s.renewalDate.toISOString(),
    autoRenew: s.autoRenew,
    status: s.status,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Translates HTTP to use cases and back. Contains no business rules. */
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  create = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const body = CreateSubscriptionBody.parse(req.body);
    const subscription = await this.service.create(actor, {
      tier: body.tier,
      billingCycle: body.billingCycle,
      autoRenew: body.autoRenew,
    });
    res.status(201).json(toSubscriptionResponse(subscription));
  };

  list = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const subscriptions = await this.service.list(actor);
    res.json({ data: subscriptions.map(toSubscriptionResponse) });
  };

  get = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const { id } = SubscriptionIdParams.parse(req.params);
    res.json(toSubscriptionResponse(await this.service.get(actor, id)));
  };

  update = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const { id } = SubscriptionIdParams.parse(req.params);
    const body = UpdateSubscriptionBody.parse(req.body);
    res.json(toSubscriptionResponse(await this.service.setAutoRenew(actor, id, body.autoRenew)));
  };

  cancel = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const { id } = SubscriptionIdParams.parse(req.params);
    res.json(toSubscriptionResponse(await this.service.cancel(actor, id)));
  };
}
