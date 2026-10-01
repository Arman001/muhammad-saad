import { Router } from 'express';
import { requireRole } from '../../shared/auth/require-role.js';
import { SubscriptionController } from './controllers/subscription-controller.js';
import type { SubscriptionService } from './domain/services/subscription-service.js';

/**
 * Controller-level authorization: every route requires an authenticated USER
 * or ADMIN. Ownership is enforced again by the domain policy in the service.
 */
export function createSubscriptionRouter(service: SubscriptionService): Router {
  const controller = new SubscriptionController(service);
  const router = Router();
  router.use(requireRole('USER', 'ADMIN'));

  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.post('/:id/cancel', controller.cancel);

  return router;
}
