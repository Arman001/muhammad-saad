import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../logger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Logs every request once, when the response finishes, with request ID,
 * user ID (once auth has run) and response time.
 *
 * A client-supplied X-Request-Id is accepted only if it is a valid UUID,
 * so arbitrary text cannot be injected into the logs.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && UUID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  // Added once, when the request completes (after authentication has run).
  // customProps is not used because it also runs at request start, which
  // produced a duplicate "userId" key.
  customSuccessObject: (req, _res, value: object) => ({
    ...value,
    userId: (req as Request).auth?.userId ?? null,
  }),
  customErrorObject: (req, _res, _error, value: object) => ({
    ...value,
    userId: (req as Request).auth?.userId ?? null,
  }),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});

/** Exposes the request ID on req.requestId for controllers and error responses. */
export const attachRequestId: RequestHandler = (req, _res, next) => {
  req.requestId = String(req.id);
  next();
};
