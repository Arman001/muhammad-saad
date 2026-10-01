import { Router } from 'express';
import { UnauthorizedError } from '../errors/index.js';

/** Authentication endpoints. Login itself happens at the identity provider. */
export function createAuthRouter(): Router {
  const router = Router();

  /** Returns the authenticated caller's internal identity. */
  router.get('/me', (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    res.json({ userId: req.auth.userId, role: req.auth.role, authSub: req.auth.authSub });
  });

  return router;
}
