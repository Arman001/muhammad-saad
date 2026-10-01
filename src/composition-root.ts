import type { AppDependencies } from './app.js';
import { config } from './config/env.js';
import { createJwtVerifier, createRemoteKeySet } from './shared/auth/jwt-verifier.js';
import { PrismaIdentityStore } from './shared/auth/prisma-identity-store.js';
import { PrismaNonceStore } from './shared/auth/prisma-nonce-store.js';
import { prisma } from './shared/db/prisma.js';

/** The single place where real implementations are created and wired together. */
export function buildDependencies(): AppDependencies {
  return {
    config,
    tokenVerifier: createJwtVerifier({
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
      getKey: createRemoteKeySet(config.AUTH_ISSUER),
    }),
    identityStore: new PrismaIdentityStore(prisma),
    nonceStore: new PrismaNonceStore(prisma),
  };
}
