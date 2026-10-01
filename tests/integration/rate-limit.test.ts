import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { config, type AppConfig } from '../../src/config/env.js';
import { createTestApp } from '../support/test-app.js';
import { authHeaders } from '../support/test-auth.js';

/** Small limits so tests can reach them quickly. */
function appWithLimits(limits: Partial<AppConfig>) {
  return createTestApp({ config: { ...config, ...limits } });
}

describe('per-IP rate limiting', () => {
  it('limits the auth endpoints per IP, even before authentication', async () => {
    const { app } = appWithLimits({ RATE_LIMIT_AUTH_PER_IP: 3 });

    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await request(app).get('/auth/me')).status);

    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('applies a global per-IP limit to every path', async () => {
    const { app } = appWithLimits({ RATE_LIMIT_GLOBAL_PER_IP: 2 });

    await request(app).get('/anything');
    await request(app).get('/something-else');
    const res = await request(app).get('/third');

    expect(res.status).toBe(429);
  });

  it('returns the standard error shape and rate-limit headers', async () => {
    const { app } = appWithLimits({ RATE_LIMIT_AUTH_PER_IP: 1 });

    const first = await request(app).get('/auth/me');
    const limited = await request(app).get('/auth/me');

    expect(first.headers['ratelimit-policy']).toBeDefined();
    expect(first.headers['ratelimit']).toBeDefined();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: expect.any(String),
        requestId: limited.headers['x-request-id'],
      },
    });
  });
});

describe('per-user rate limiting', () => {
  it('limits each user separately', async () => {
    const { app } = appWithLimits({ RATE_LIMIT_SUBSCRIPTIONS_PER_USER: 2 });
    const alice = { sub: 'auth0|alice' };
    const bob = { sub: 'auth0|bob' };

    const aliceStatuses = [];
    for (let i = 0; i < 3; i += 1) {
      aliceStatuses.push(
        (
          await request(app)
            .get('/subscriptions')
            .set(await authHeaders(alice))
        ).status,
      );
    }
    const bobStatus = (
      await request(app)
        .get('/subscriptions')
        .set(await authHeaders(bob))
    ).status;

    expect(aliceStatuses).toEqual([200, 200, 429]);
    expect(bobStatus).toBe(200);
  });

  it('uses different limits per route group', async () => {
    const { app } = appWithLimits({
      RATE_LIMIT_CHAT_PER_USER: 1,
      RATE_LIMIT_SUBSCRIPTIONS_PER_USER: 5,
    });
    const alice = { sub: 'auth0|alice' };

    const firstChat = await request(app)
      .post('/chat/messages')
      .set(await authHeaders(alice))
      .send({ question: 'a' });
    const secondChat = await request(app)
      .post('/chat/messages')
      .set(await authHeaders(alice))
      .send({ question: 'b' });
    const subscriptions = await request(app)
      .get('/subscriptions')
      .set(await authHeaders(alice));

    expect(firstChat.status).toBe(201);
    expect(secondChat.status).toBe(429);
    expect(subscriptions.status).toBe(200);
  });

  it('does not consume quota for a rate-limited chat request', async () => {
    const { app, quotaLedger } = appWithLimits({ RATE_LIMIT_CHAT_PER_USER: 1 });
    const alice = { sub: 'auth0|alice' };

    await request(app)
      .post('/chat/messages')
      .set(await authHeaders(alice))
      .send({ question: 'a' });
    await request(app)
      .post('/chat/messages')
      .set(await authHeaders(alice))
      .send({ question: 'b' });

    expect([...quotaLedger.freeUsed.values()]).toEqual([1]);
  });
});
