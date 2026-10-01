import { createApp, type AppDependencies } from '../../src/app.js';
import { config } from '../../src/config/env.js';
import { SubscriptionService } from '../../src/modules/subscriptions/domain/services/subscription-service.js';
import { createJwtVerifier } from '../../src/shared/auth/jwt-verifier.js';
import { systemClock } from '../../src/shared/kernel/clock.js';
import { FakePaymentGateway } from './fake-payment-gateway.js';
import { InMemoryIdentityStore, InMemoryNonceStore } from './in-memory-stores.js';
import { InMemorySubscriptionRepository } from './in-memory-subscription-repository.js';
import { testKeySet } from './test-auth.js';

/**
 * The test composition root: the real app, with test doubles only at the
 * edges (identity provider keys, storage, payment provider).
 */
export function createTestApp(overrides: Partial<AppDependencies> = {}) {
  const identityStore = new InMemoryIdentityStore();
  const nonceStore = new InMemoryNonceStore();
  const subscriptionRepository = new InMemorySubscriptionRepository();
  const paymentGateway = new FakePaymentGateway();

  const deps: AppDependencies = {
    config,
    tokenVerifier: createJwtVerifier({
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
      getKey: testKeySet,
    }),
    identityStore,
    nonceStore,
    subscriptionService: new SubscriptionService(
      subscriptionRepository,
      paymentGateway,
      systemClock,
    ),
    ...overrides,
  };

  return {
    app: createApp(deps),
    identityStore,
    nonceStore,
    subscriptionRepository,
    paymentGateway,
  };
}
