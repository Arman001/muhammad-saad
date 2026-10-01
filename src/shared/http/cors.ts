import cors from 'cors';
import type { RequestHandler } from 'express';
import { OriginNotAllowedError } from '../errors/index.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Request-Id',
  'X-Request-Timestamp',
  'X-Request-Nonce',
];
const EXPOSED_HEADERS = ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'];

/**
 * Restricted CORS.
 *
 * A browser request from an origin that is not on the allowlist is rejected
 * with 403 before any processing, instead of only omitting CORS headers
 * (which would still run the request on the server).
 *
 * Requests without an Origin header (curl, server-to-server) pass here,
 * because CORS is a browser protection; they still need a valid token later.
 */
export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler[] {
  // Normalize to bare origins so a trailing slash in config cannot cause a mismatch.
  const allowed = new Set(allowedOrigins.map((value) => new URL(value).origin));

  const originGuard: RequestHandler = (req, _res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      next(new OriginNotAllowedError());
      return;
    }
    next();
  };

  const corsHandler = cors({
    origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    credentials: false,
    maxAge: 600,
  });

  return [originGuard, corsHandler];
}
