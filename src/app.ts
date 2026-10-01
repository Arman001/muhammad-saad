import express from 'express';
import type { AppConfig } from './config/env.js';
import { createAuthRouter } from './shared/auth/auth-routes.js';
import { authenticate } from './shared/auth/authenticate.js';
import { requireHealthKey } from './shared/auth/health-key.js';
import type { IdentityStore, NonceStore, TokenVerifier } from './shared/auth/ports.js';
import { requireJsonContentType, jsonBodyParser } from './shared/http/content-type.js';
import { createCorsMiddleware } from './shared/http/cors.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import { createRateLimiters } from './shared/http/rate-limit.js';
import { attachRequestId, requestLogger } from './shared/http/request-logger.js';
import { requestTimeout } from './shared/http/request-timeout.js';
import { securityHeaders } from './shared/http/security-headers.js';
import type { ChatService } from './modules/chat/domain/services/chat-service.js';
import { createChatRouter } from './modules/chat/routes.js';
import type { SubscriptionService } from './modules/subscriptions/domain/services/subscription-service.js';
import { createSubscriptionRouter } from './modules/subscriptions/routes.js';

/** Everything the app needs from the outside world. Built in the composition root. */
export interface AppDependencies {
  readonly config: AppConfig;
  readonly tokenVerifier: TokenVerifier;
  readonly identityStore: IdentityStore;
  readonly nonceStore: NonceStore;
  readonly subscriptionService: SubscriptionService;
  readonly chatService: ChatService;
}

export function createApp(deps: AppDependencies) {
  const { config } = deps;
  const app = express();
  app.disable('x-powered-by');
  // Correct client IPs (for rate limiting and logs) when behind a reverse proxy.
  app.set('trust proxy', config.TRUST_PROXY);
  const limiters = createRateLimiters(config);

  // 1. Observability first, so every later failure is logged with a request ID.
  app.use(requestLogger);
  app.use(attachRequestId);

  // 2. Security gate: runs before authentication and before any route.
  app.use(securityHeaders);
  app.use(createCorsMiddleware(config.CORS_ORIGINS));
  app.use(requestTimeout(config.REQUEST_TIMEOUT_MS));
  app.use(requireJsonContentType);
  app.use(jsonBodyParser(config.BODY_LIMIT));

  // 3. Per-IP rate limits, before any authentication work (signature checks,
  //    database lookups), so floods and token guessing are cut off cheaply.
  app.use(limiters.globalPerIp);
  app.use('/auth', limiters.perIp.auth);
  app.use('/chat', limiters.perIp.chat);
  app.use('/subscriptions', limiters.perIp.subscriptions);

  // 4. Health check: protected by an internal key instead of a user token,
  //    so monitoring systems can call it without logging in.
  app.get('/health', requireHealthKey(config.HEALTH_API_KEY), (_req, res) => {
    res.json({ status: 'ok' });
  });

  // 5. Authentication for everything below. Deny by default: no route after
  //    this line can be reached without a valid token and a fresh nonce.
  app.use(
    authenticate({
      verifier: deps.tokenVerifier,
      identities: deps.identityStore,
      nonces: deps.nonceStore,
      replayWindowSeconds: config.NONCE_WINDOW_SECONDS,
    }),
  );

  // 6. Routes, each with its own per-user limit (keyed by the verified user ID).
  app.use('/auth', limiters.perUser.auth, createAuthRouter());
  app.use(
    '/subscriptions',
    limiters.perUser.subscriptions,
    createSubscriptionRouter(deps.subscriptionService),
  );
  app.use('/chat', limiters.perUser.chat, createChatRouter(deps.chatService));

  // 7. Unknown routes (only reachable when authenticated) and error formatting.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
