import type { AppDependencies } from './app.js';
import { config } from './config/env.js';
import { createJwtVerifier, createRemoteKeySet } from './shared/auth/jwt-verifier.js';
import { PrismaIdentityStore } from './shared/auth/prisma-identity-store.js';
import { PrismaNonceStore } from './shared/auth/prisma-nonce-store.js';
import { ChatService } from './modules/chat/domain/services/chat-service.js';
import { MockOpenAiClient } from './modules/chat/infrastructure/mock-openai-client.js';
import { PrismaChatMessageRepository } from './modules/chat/repositories/prisma-chat-message-repository.js';
import { PrismaQuotaLedger } from './modules/chat/repositories/prisma-quota-ledger.js';
import { SubscriptionService } from './modules/subscriptions/domain/services/subscription-service.js';
import { SimulatedPaymentGateway } from './modules/subscriptions/infrastructure/simulated-payment-gateway.js';
import { PrismaSubscriptionRepository } from './modules/subscriptions/repositories/prisma-subscription-repository.js';
import { prisma } from './shared/db/prisma.js';
import { systemClock } from './shared/kernel/clock.js';

/** The single place where real implementations are created and wired together. */
export function buildDependencies(): AppDependencies {
  const subscriptionRepository = new PrismaSubscriptionRepository(prisma);
  const paymentGateway = new SimulatedPaymentGateway(config.PAYMENT_FAILURE_RATE);

  return {
    config,
    tokenVerifier: createJwtVerifier({
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
      getKey: createRemoteKeySet(config.AUTH_ISSUER),
    }),
    identityStore: new PrismaIdentityStore(prisma),
    nonceStore: new PrismaNonceStore(prisma),
    subscriptionService: new SubscriptionService(
      subscriptionRepository,
      paymentGateway,
      systemClock,
    ),
    chatService: new ChatService(
      new PrismaQuotaLedger(prisma),
      new MockOpenAiClient(config.MOCK_AI_LATENCY_MS),
      new PrismaChatMessageRepository(prisma),
      systemClock,
    ),
  };
}
