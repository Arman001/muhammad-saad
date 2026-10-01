import type { Request } from 'express';
import { UnauthorizedError } from '../errors/index.js';
import type { AuthContext } from './auth-context.js';

/** Returns the authenticated caller. Fails closed if authentication did not run. */
export function requireActor(req: Request): AuthContext {
  if (!req.auth) {
    throw new UnauthorizedError();
  }
  return req.auth;
}
