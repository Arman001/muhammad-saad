import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireRole } from '../../src/shared/auth/require-role.js';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { attachRequestId, requestLogger } from '../../src/shared/http/request-logger.js';
import { createTestApp } from '../support/test-app.js';
import {
  authHeaders,
  signTestToken,
  TEST_HEALTH_KEY,
  untrustedKeys,
} from '../support/test-auth.js';

describe('authentication: access tokens', () => {
  it('accepts a valid token and provisions the user as USER', async () => {
    const { app, identityStore } = createTestApp();

    const res = await request(app)
      .get('/auth/me')
      .set(await authHeaders({ sub: 'auth0|alice' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authSub: 'auth0|alice', role: 'USER' });
    expect(identityStore.users.has('auth0|alice')).toBe(true);
  });

  it('rejects a request without a token', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a non-Bearer authorization scheme', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/auth/me').set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  it.each([
    ['an expired token', { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
    ['the wrong audience', { audience: 'https://some-other-api' }],
    ['the wrong issuer', { issuer: 'https://evil-issuer.example.com/' }],
    ['a signature from an untrusted key', { signingKey: untrustedKeys.privateKey }],
  ])('rejects a token with %s', async (_label, tokenOptions) => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/auth/me')
      .set(await authHeaders(tokenOptions));

    expect(res.status).toBe(401);
    // The response never reveals which check failed.
    expect(res.body.error.message).toBe('Invalid or expired access token.');
  });

  it('rejects an unsigned token (alg: none)', async () => {
    const { app } = createTestApp();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'auth0|attacker',
        iss: 'https://test-issuer.example.com/',
        aud: 'https://chat-api.test',
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url');

    const res = await request(app)
      .get('/auth/me')
      .set({
        Authorization: `Bearer ${header}.${payload}.x`,
        'X-Request-Timestamp': String(Date.now()),
        'X-Request-Nonce': randomUUID(),
      });

    expect(res.status).toBe(401);
  });
});

describe('authentication: replay protection', () => {
  it('rejects a valid token without timestamp and nonce headers', async () => {
    const { app } = createTestApp();
    const token = await signTestToken();

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('X-Request-Nonce');
  });

  it('rejects a request with a stale timestamp', async () => {
    const { app } = createTestApp();
    const headers = await authHeaders();
    headers['X-Request-Timestamp'] = String(Date.now() - 10 * 60 * 1000);

    const res = await request(app).get('/auth/me').set(headers);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('outside the allowed window');
  });

  it('rejects a replayed request that reuses a nonce', async () => {
    const { app } = createTestApp();
    const headers = await authHeaders();

    const first = await request(app).get('/auth/me').set(headers);
    const replay = await request(app).get('/auth/me').set(headers);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toContain('already been used');
  });

  it('accepts consecutive requests with fresh nonces', async () => {
    const { app } = createTestApp();

    const first = await request(app)
      .get('/auth/me')
      .set(await authHeaders());
    const second = await request(app)
      .get('/auth/me')
      .set(await authHeaders());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});

describe('deny by default', () => {
  it('returns 401 for unknown routes when unauthenticated', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/admin/secret-thing');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown routes only after authentication', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/admin/secret-thing')
      .set(await authHeaders());
    expect(res.status).toBe(404);
  });
});

describe('health endpoint', () => {
  it('rejects requests without the health key', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong health key', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health').set('X-Health-Key', 'wrong-key-wrong-key');
    expect(res.status).toBe(401);
  });

  it('accepts the correct key without needing a user token', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health').set('X-Health-Key', TEST_HEALTH_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('role-based access control (controller level)', () => {
  function appWithAdminRoute(role: 'USER' | 'ADMIN' | null) {
    const app = express();
    app.use(requestLogger, attachRequestId);
    app.use((req, _res, next) => {
      if (role) req.auth = { userId: 'u1', role, authSub: 'auth0|u1' };
      next();
    });
    app.get('/admin-only', requireRole('ADMIN'), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it('allows an admin', async () => {
    const res = await request(appWithAdminRoute('ADMIN')).get('/admin-only');
    expect(res.status).toBe(200);
  });

  it('forbids a regular user with 403', async () => {
    const res = await request(appWithAdminRoute('USER')).get('/admin-only');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const res = await request(appWithAdminRoute(null)).get('/admin-only');
    expect(res.status).toBe(401);
  });
});
