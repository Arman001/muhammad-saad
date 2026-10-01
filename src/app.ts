import express from 'express';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import { attachRequestId, requestLogger } from './shared/http/request-logger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Observability first, so every later failure is logged with a request ID.
  app.use(requestLogger);
  app.use(attachRequestId);

  // TEMPORARY: open health check until the security gate and auth are in place.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
