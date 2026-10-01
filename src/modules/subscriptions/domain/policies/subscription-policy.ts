import { isAdmin, type Actor } from '../../../../shared/kernel/actor.js';
import type { Subscription } from '../entities/subscription.js';

/**
 * Domain-level authorization, independent of the HTTP layer.
 * Users may only see and manage their own subscriptions; admins may access all.
 */
export function canAccessSubscription(actor: Actor, subscription: Subscription): boolean {
  return isAdmin(actor) || subscription.userId === actor.userId;
}
