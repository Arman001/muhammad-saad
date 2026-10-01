import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/test-app.js';
import { authHeaders } from '../support/test-auth.js';

const ALICE = { sub: 'auth0|alice' };
const BOB = { sub: 'auth0|bob' };

async function createSubscription(
  app: ReturnType<typeof createTestApp>['app'],
  body: Record<string, unknown>,
  user = ALICE,
) {
  return request(app)
    .post('/subscriptions')
    .set(await authHeaders(user))
    .send(body);
}

describe('POST /subscriptions', () => {
  it('creates a bundle with values from the catalog', async () => {
    const { app } = createTestApp();

    const res = await createSubscription(app, { tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tier: 'PRO',
      billingCycle: 'MONTHLY',
      maxMessages: 100,
      usedMessages: 0,
      remainingMessages: 100,
      price: '29.99',
      currency: 'USD',
      autoRenew: true,
      status: 'ACTIVE',
      cancelledAt: null,
    });
    expect(new Date(res.body.endDate).getTime()).toBeGreaterThan(
      new Date(res.body.startDate).getTime(),
    );
  });

  it('creates an Enterprise bundle with unlimited messages', async () => {
    const { app } = createTestApp();
    const res = await createSubscription(app, {
      tier: 'ENTERPRISE',
      billingCycle: 'YEARLY',
      autoRenew: false,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      maxMessages: null,
      remainingMessages: null,
      price: '999.00',
      autoRenew: false,
    });
  });

  it('returns 402 and creates nothing when payment fails', async () => {
    const { app, paymentGateway, subscriptionRepository } = createTestApp();
    paymentGateway.failNext();

    const res = await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_FAILED');
    expect(subscriptionRepository.rows.size).toBe(0);
  });

  it.each([
    ['an unknown tier', { tier: 'GOLD', billingCycle: 'MONTHLY' }],
    ['a missing billing cycle', { tier: 'BASIC' }],
    ['a non-boolean autoRenew', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: 'yes' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { app } = createTestApp();
    const res = await createSubscription(app, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects extra fields, preventing mass assignment', async () => {
    const { app, subscriptionRepository } = createTestApp();

    const res = await createSubscription(app, {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      price: 0,
      maxMessages: 999999,
      userId: 'someone-else',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].code).toBe('unrecognized_keys');
    expect(subscriptionRepository.rows.size).toBe(0);
  });

  it('requires authentication', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/subscriptions')
      .send({ tier: 'BASIC', billingCycle: 'MONTHLY' });
    expect(res.status).toBe(401);
  });
});

describe('GET /subscriptions', () => {
  it("lists only the caller's own subscriptions", async () => {
    const { app } = createTestApp();
    await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' }, ALICE);
    await createSubscription(app, { tier: 'PRO', billingCycle: 'MONTHLY' }, BOB);

    const res = await request(app)
      .get('/subscriptions')
      .set(await authHeaders(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].tier).toBe('BASIC');
  });

  it('lets an admin list everyone’s subscriptions', async () => {
    const { app, identityStore } = createTestApp();
    await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' }, ALICE);
    await createSubscription(app, { tier: 'PRO', billingCycle: 'MONTHLY' }, BOB);
    identityStore.setRole('auth0|admin', 'ADMIN');

    const res = await request(app)
      .get('/subscriptions')
      .set(await authHeaders({ sub: 'auth0|admin' }));

    expect(res.body.data).toHaveLength(2);
  });
});

describe('GET /subscriptions/:id', () => {
  it('returns the caller’s subscription', async () => {
    const { app } = createTestApp();
    const created = await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' });

    const res = await request(app)
      .get(`/subscriptions/${created.body.id}`)
      .set(await authHeaders(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("returns 404 for another user's subscription, hiding that it exists", async () => {
    const { app } = createTestApp();
    const created = await createSubscription(
      app,
      { tier: 'BASIC', billingCycle: 'MONTHLY' },
      ALICE,
    );

    const res = await request(app)
      .get(`/subscriptions/${created.body.id}`)
      .set(await authHeaders(BOB));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id with 400', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/subscriptions/not-a-uuid')
      .set(await authHeaders(ALICE));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /subscriptions/:id', () => {
  it('toggles auto-renew', async () => {
    const { app } = createTestApp();
    const created = await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' });

    const res = await request(app)
      .patch(`/subscriptions/${created.body.id}`)
      .set(await authHeaders(ALICE))
      .send({ autoRenew: false });

    expect(res.status).toBe(200);
    expect(res.body.autoRenew).toBe(false);
  });

  it('only accepts autoRenew', async () => {
    const { app } = createTestApp();
    const created = await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' });

    const res = await request(app)
      .patch(`/subscriptions/${created.body.id}`)
      .set(await authHeaders(ALICE))
      .send({ autoRenew: true, status: 'ACTIVE', usedMessages: 0 });

    expect(res.status).toBe(400);
  });
});

describe('POST /subscriptions/:id/cancel', () => {
  it('cancels: auto-renew off, still active until the period ends', async () => {
    const { app } = createTestApp();
    const created = await createSubscription(app, { tier: 'PRO', billingCycle: 'MONTHLY' });

    const res = await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`)
      .set(await authHeaders(ALICE));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ autoRenew: false, status: 'ACTIVE' });
    expect(res.body.cancelledAt).not.toBeNull();
  });

  it('returns 409 when cancelling twice', async () => {
    const { app } = createTestApp();
    const created = await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' });
    const url = `/subscriptions/${created.body.id}/cancel`;

    await request(app)
      .post(url)
      .set(await authHeaders(ALICE));
    const second = await request(app)
      .post(url)
      .set(await authHeaders(ALICE));

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SUBSCRIPTION_ALREADY_CANCELLED');
  });

  it('returns 409 when re-enabling auto-renew after cancelling', async () => {
    const { app } = createTestApp();
    const created = await createSubscription(app, { tier: 'BASIC', billingCycle: 'MONTHLY' });
    await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`)
      .set(await authHeaders(ALICE));

    const res = await request(app)
      .patch(`/subscriptions/${created.body.id}`)
      .set(await authHeaders(ALICE))
      .send({ autoRenew: true });

    expect(res.status).toBe(409);
  });

  it("cannot cancel another user's subscription", async () => {
    const { app, subscriptionRepository } = createTestApp();
    const created = await createSubscription(
      app,
      { tier: 'BASIC', billingCycle: 'MONTHLY' },
      ALICE,
    );

    const res = await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`)
      .set(await authHeaders(BOB));

    expect(res.status).toBe(404);
    expect(subscriptionRepository.rows.get(created.body.id)?.cancelledAt).toBeNull();
  });
});
