import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/config/env.js';
import { createTestApp } from '../support/test-app.js';
import { authHeaders } from '../support/test-auth.js';

const ALICE = { sub: 'auth0|alice' };
const BOB = { sub: 'auth0|bob' };

async function ask(app: ReturnType<typeof createTestApp>['app'], body: unknown, user = ALICE) {
  return request(app)
    .post('/chat/messages')
    .set(await authHeaders(user))
    .send(body as object);
}

describe('POST /chat/messages', () => {
  it('returns the mocked answer with token usage and quota source', async () => {
    const { app } = createTestApp();

    const res = await ask(app, { question: 'Explain quotas' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      question: 'Explain quotas',
      answer: 'Answer to: Explain quotas',
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      quota: { source: 'FREE', subscriptionId: null },
      requestId: res.headers['x-request-id'],
    });
  });

  it('returns a typed 402 once the free quota is used and no bundle exists', async () => {
    const { app } = createTestApp();
    for (let i = 0; i < 3; i += 1) expect((await ask(app, { question: `q${i}` })).status).toBe(201);

    const res = await ask(app, { question: 'fourth' });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: { freeLimit: 3, freeUsed: 3, activeBundlesWithQuota: 0 },
    });
    expect(res.body.error.details.freeResetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00.000Z$/);
  });

  it('continues with a purchased bundle after the free quota', async () => {
    const { app } = createTestApp();
    const sub = await request(app)
      .post('/subscriptions')
      .set(await authHeaders(ALICE))
      .send({ tier: 'BASIC', billingCycle: 'MONTHLY' });
    for (let i = 0; i < 3; i += 1) await ask(app, { question: `q${i}` });

    const res = await ask(app, { question: 'paid' });

    expect(res.status).toBe(201);
    expect(res.body.quota).toEqual({ source: 'SUBSCRIPTION', subscriptionId: sub.body.id });
  });

  it('strips HTML from the question before storing it (XSS)', async () => {
    const { app, chatMessages } = createTestApp();

    const res = await ask(app, {
      question: 'Hello <script>alert(1)</script><b onclick="x()">world</b>',
    });

    expect(res.status).toBe(201);
    expect(res.body.question).toBe('Hello world');
    expect(chatMessages.messages[0]?.snapshot().question).toBe('Hello world');
  });

  it('rejects a question that is only HTML', async () => {
    const { app } = createTestApp();
    const res = await ask(app, { question: '<img src=x onerror=alert(1)>' });
    expect(res.status).toBe(400);
  });

  it.each([
    ['a missing question', {}],
    ['an empty question', { question: '   ' }],
    ['a non-string question', { question: 42 }],
    ['extra fields', { question: 'hi', userId: 'someone-else', source: 'SUBSCRIPTION' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { app, aiClient } = createTestApp();

    const res = await ask(app, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(aiClient.prompts).toHaveLength(0);
  });

  it('rejects a question over 2,000 characters with 400', async () => {
    // Use the production body limit so the request reaches validation.
    const { app } = createTestApp({ config: { ...config, BODY_LIMIT: '10kb' } });
    const res = await ask(app, { question: 'x'.repeat(2_001) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 503 and refunds the message when the AI is down', async () => {
    const { app, aiClient } = createTestApp();
    aiClient.failing = true;

    const res = await ask(app, { question: 'hello' });
    aiClient.failing = false;
    const usage = await request(app)
      .get('/chat/usage')
      .set(await authHeaders(ALICE));

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(usage.body.free.used).toBe(0);
  });

  it('requires authentication', async () => {
    const { app } = createTestApp();
    const res = await request(app).post('/chat/messages').send({ question: 'hi' });
    expect(res.status).toBe(401);
  });
});

describe('GET /chat/messages', () => {
  it("returns only the caller's history, newest first", async () => {
    const { app } = createTestApp();
    await ask(app, { question: 'first' }, ALICE);
    await ask(app, { question: 'second' }, ALICE);
    await ask(app, { question: 'bob asks' }, BOB);

    const res = await request(app)
      .get('/chat/messages')
      .set(await authHeaders(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { question: string }) => m.question)).toEqual(['second', 'first']);
  });

  it('validates the limit parameter', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/chat/messages?limit=1000')
      .set(await authHeaders(ALICE));
    expect(res.status).toBe(400);
  });

  it("returns 404 for another user's message", async () => {
    const { app } = createTestApp();
    const created = await ask(app, { question: 'private' }, ALICE);

    const res = await request(app)
      .get(`/chat/messages/${created.body.id}`)
      .set(await authHeaders(BOB));

    expect(res.status).toBe(404);
  });
});

describe('GET /chat/usage', () => {
  it('reports free usage, reset time and bundle balances', async () => {
    const { app } = createTestApp();
    await request(app)
      .post('/subscriptions')
      .set(await authHeaders(ALICE))
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });
    await ask(app, { question: 'q' });

    const res = await request(app)
      .get('/chat/usage')
      .set(await authHeaders(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.free).toMatchObject({ limit: 3, used: 1, remaining: 2 });
    expect(res.body.bundles).toEqual([expect.objectContaining({ tier: 'PRO', remaining: 100 })]);
  });
});
