import { isAdmin, type Actor } from '../../../../shared/kernel/actor.js';
import type { ChatMessage } from '../entities/chat-message.js';

/** Users may only read their own chats; admins may read all. */
export function canViewChatMessage(actor: Actor, message: ChatMessage): boolean {
  return isAdmin(actor) || message.userId === actor.userId;
}
