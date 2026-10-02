import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/test-app.js';
import { authHeaders } from '../support/test-auth.js';

describe('GET /admin/metrics', () => {
  it('returns system metrics to an admin', async () => {
    const { app, identityStore } = createTestApp();
    identityStore.setRole('auth0|admin', 'ADMIN');

    const res = await request(app)
      .get('/admin/metrics')
      .set(await authHeaders({ sub: 'auth0|admin' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      users: { total: 2 },
      subscriptions: { active: 1 },
      messages: { bySource: { FREE: 3, SUBSCRIPTION: 1 } },
      payments: { revenue: '29.99' },
    });
  });

  it('forbids regular users without computing anything', async () => {
    const { app, metricsSource } = createTestApp();

    const res = await request(app)
      .get('/admin/metrics')
      .set(await authHeaders({ sub: 'auth0|alice' }));

    expect(res.status).toBe(403);
    expect(metricsSource.calls).toBe(0);
  });

  it('rejects anonymous callers', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/admin/metrics');
    expect(res.status).toBe(401);
  });
});
