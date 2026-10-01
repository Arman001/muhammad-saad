export type UsageSource = 'FREE' | 'SUBSCRIPTION';

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChatMessageProps {
  readonly id: string;
  readonly userId: string;
  readonly question: string;
  readonly answer: string;
  readonly usage: TokenUsage;
  readonly source: UsageSource;
  readonly subscriptionId: string | null;
  /** Links the stored message to the request logs. */
  readonly requestId: string;
  readonly createdAt: Date;
}

/** A stored question and answer. Immutable once created: history is never rewritten. */
export class ChatMessage {
  private constructor(private readonly props: ChatMessageProps) {}

  static create(props: ChatMessageProps): ChatMessage {
    if (props.source === 'SUBSCRIPTION' && props.subscriptionId === null) {
      throw new Error('A subscription-paid message must reference its subscription');
    }
    if (props.source === 'FREE' && props.subscriptionId !== null) {
      throw new Error('A free message cannot reference a subscription');
    }
    return new ChatMessage({ ...props });
  }

  static restore(props: ChatMessageProps): ChatMessage {
    return new ChatMessage({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }

  snapshot(): Readonly<ChatMessageProps> {
    return { ...this.props };
  }
}
