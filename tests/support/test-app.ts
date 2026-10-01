import { createApp, type AppDependencies } from '../../src/app.js';
import { config } from '../../src/config/env.js';
import { createJwtVerifier } from '../../src/shared/auth/jwt-verifier.js';
import { InMemoryIdentityStore, InMemoryNonceStore } from './in-memory-stores.js';
import { testKeySet } from './test-auth.js';

/** Builds the real app with test doubles only at the edges (identity provider keys, stores). */
export function createTestApp(overrides: Partial<AppDependencies> = {}) {
  const identityStore = new InMemoryIdentityStore();
  const nonceStore = new InMemoryNonceStore();

  const deps: AppDependencies = {
    config,
    tokenVerifier: createJwtVerifier({
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
      getKey: testKeySet,
    }),
    identityStore,
    nonceStore,
    ...overrides,
  };

  return { app: createApp(deps), identityStore, nonceStore };
}
