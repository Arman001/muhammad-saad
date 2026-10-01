import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/index.js';
import type { Role } from '../kernel/actor.js';

/**
 * Controller-level authorization. Domain policies add a second, independent
 * check (for example, ownership) inside each module.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
