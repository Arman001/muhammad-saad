import express from 'express';
import { config as defaultConfig, type AppConfig } from './config/env.js';
import { requireJsonContentType, jsonBodyParser } from './shared/http/content-type.js';
import { createCorsMiddleware } from './shared/http/cors.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import { attachRequestId, requestLogger } from './shared/http/request-logger.js';
import { requestTimeout } from './shared/http/request-timeout.js';
import { securityHeaders } from './shared/http/security-headers.js';

export function createApp(config: AppConfig = defaultConfig) {
  const app = express();
  app.disable('x-powered-by');

  // 1. Observability first, so every later failure is logged with a request ID.
  app.use(requestLogger);
  app.use(attachRequestId);

  // 2. Security gate: runs before authentication and before any route.
  app.use(securityHeaders);
  app.use(createCorsMiddleware(config.CORS_ORIGINS));
  app.use(requestTimeout(config.REQUEST_TIMEOUT_MS));
  app.use(requireJsonContentType);
  app.use(jsonBodyParser(config.BODY_LIMIT));

  // TEMPORARY: open health check until authentication is in place.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
