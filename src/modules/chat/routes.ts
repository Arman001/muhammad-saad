import { Router } from 'express';
import { requireRole } from '../../shared/auth/require-role.js';
import { ChatController } from './controllers/chat-controller.js';
import type { ChatService } from './domain/services/chat-service.js';

export function createChatRouter(service: ChatService): Router {
  const controller = new ChatController(service);
  const router = Router();
  router.use(requireRole('USER', 'ADMIN'));

  router.post('/messages', controller.ask);
  router.get('/messages', controller.list);
  router.get('/messages/:id', controller.get);
  router.get('/usage', controller.usage);

  return router;
}
