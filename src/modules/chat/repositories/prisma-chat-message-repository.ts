import type { ChatMessage as ChatMessageRow, PrismaClient } from '@prisma/client';
import { ChatMessage } from '../domain/entities/chat-message.js';
import type { ChatMessageRepository } from '../domain/ports.js';

function toDomain(row: ChatMessageRow): ChatMessage {
  return ChatMessage.restore({
    id: row.id,
    userId: row.userId,
    question: row.question,
    answer: row.answer,
    usage: {
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
    },
    source: row.source,
    subscriptionId: row.subscriptionId,
    requestId: row.requestId,
    createdAt: row.createdAt,
  });
}

export class PrismaChatMessageRepository implements ChatMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(message: ChatMessage): Promise<void> {
    const m = message.snapshot();
    await this.prisma.chatMessage.create({
      data: {
        id: m.id,
        userId: m.userId,
        question: m.question,
        answer: m.answer,
        promptTokens: m.usage.promptTokens,
        completionTokens: m.usage.completionTokens,
        totalTokens: m.usage.totalTokens,
        source: m.source,
        subscriptionId: m.subscriptionId,
        requestId: m.requestId,
        createdAt: m.createdAt,
      },
    });
  }

  async findById(id: string): Promise<ChatMessage | null> {
    const row = await this.prisma.chatMessage.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listByUser(userId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async listAll(limit: number): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }
}
