import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/index.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Protects the health endpoint with a shared key in the X-Health-Key header.
 * Compared in constant time (on fixed-length digests) so the key cannot be
 * discovered by measuring response times.
 */
export function requireHealthKey(expectedKey: string): RequestHandler {
  const expected = digest(expectedKey);

  return (req, _res, next) => {
    const provided = req.headers['x-health-key'];
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expected)) {
      next(new UnauthorizedError());
      return;
    }
    next();
  };
}
