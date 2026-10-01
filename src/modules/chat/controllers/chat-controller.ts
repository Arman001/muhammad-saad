import type { Request, Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { requireActor } from '../../../shared/auth/require-actor.js';
import type { ChatMessage } from '../domain/entities/chat-message.js';
import type { ChatService } from '../domain/services/chat-service.js';

const MAX_QUESTION_LENGTH = 2_000;

/** Removes all HTML (tags and their attributes), leaving plain text. XSS protection on input. */
const stripHtml = (value: string) =>
  sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();

const AskBody = z.strictObject({
  question: z
    .string()
    .trim()
    .min(1, 'Question is required.')
    .max(MAX_QUESTION_LENGTH)
    .transform(stripHtml)
    .pipe(z.string().min(1, 'Question is empty after removing HTML.')),
});

const MessageIdParams = z.strictObject({ id: z.uuid() });

const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function toChatMessageResponse(message: ChatMessage) {
  const m = message.snapshot();
  return {
    id: m.id,
    userId: m.userId,
    question: m.question,
    answer: m.answer,
    usage: m.usage,
    quota: { source: m.source, subscriptionId: m.subscriptionId },
    requestId: m.requestId,
    createdAt: m.createdAt.toISOString(),
  };
}

export class ChatController {
  constructor(private readonly service: ChatService) {}

  ask = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const { question } = AskBody.parse(req.body);
    const { message } = await this.service.ask(actor, question, req.requestId);
    res.status(201).json(toChatMessageResponse(message));
  };

  list = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const { limit } = ListQuery.parse(req.query);
    const messages = await this.service.list(actor, limit);
    res.json({ data: messages.map(toChatMessageResponse) });
  };

  get = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const { id } = MessageIdParams.parse(req.params);
    res.json(toChatMessageResponse(await this.service.get(actor, id)));
  };

  usage = async (req: Request, res: Response) => {
    const actor = requireActor(req);
    const usage = await this.service.usage(actor);
    res.json({
      period: usage.period,
      free: {
        limit: usage.freeLimit,
        used: usage.freeUsed,
        remaining: Math.max(0, usage.freeLimit - usage.freeUsed),
        resetsAt: usage.freeResetsAt.toISOString(),
      },
      bundles: usage.bundles.map((b) => ({
        subscriptionId: b.subscriptionId,
        tier: b.tier,
        remaining: b.remaining,
        endDate: b.endDate.toISOString(),
      })),
    });
  };
}
