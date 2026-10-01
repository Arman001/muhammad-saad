import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AiClient, AiCompletion } from '../domain/ports.js';

/** The subset of OpenAI's Chat Completions response this app uses. */
interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop';
  }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const MODEL = 'gpt-4o-mini';

/** Rough token estimate (~4 characters per token for English), like OpenAI's rule of thumb. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Mocked OpenAI client. Produces a response in OpenAI's Chat Completions shape
 * after a simulated network latency, then maps it to the domain's AiCompletion.
 * Replacing it with the real OpenAI SDK only changes `requestCompletion`.
 */
export class MockOpenAiClient implements AiClient {
  constructor(private readonly latencyMs: number) {}

  async complete(prompt: string): Promise<AiCompletion> {
    const response = await this.requestCompletion(prompt);
    const content = response.choices[0]?.message.content ?? '';
    return {
      answer: content,
      model: response.model,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }

  private async requestCompletion(prompt: string): Promise<OpenAiChatCompletion> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);

    const preview = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
    const content = `This is a mocked response from ${MODEL}. You asked: "${preview}"`;
    const promptTokens = estimateTokens(prompt);
    const completionTokens = estimateTokens(content);

    return {
      id: `chatcmpl-mock-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
}
