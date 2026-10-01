export const TIERS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export type Tier = (typeof TIERS)[number];

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface TierDefinition {
  /** Messages included per billing period. null means unlimited. */
  readonly maxMessages: number | null;
  /** Price per billing period, in cents, to avoid floating-point money. */
  readonly priceCents: Readonly<Record<BillingCycle, number>>;
}

/**
 * Bundle definitions. Message counts come from the specification; prices are
 * not specified and are documented as assumptions in the README.
 */
export const TIER_CATALOG: Readonly<Record<Tier, TierDefinition>> = {
  BASIC: { maxMessages: 10, priceCents: { MONTHLY: 999, YEARLY: 9_900 } },
  PRO: { maxMessages: 100, priceCents: { MONTHLY: 2_999, YEARLY: 29_900 } },
  ENTERPRISE: { maxMessages: null, priceCents: { MONTHLY: 9_999, YEARLY: 99_900 } },
};
