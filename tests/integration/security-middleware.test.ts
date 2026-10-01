import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/shared/http/error-handler.js';
import { attachRequestId, requestLogger } from '../../src/shared/http/request-logger.js';
import { requestTimeout } from '../../src/shared/http/request-timeout.js';
import { createTestApp } from '../support/test-app.js';
import { TEST_HEALTH_KEY } from '../support/test-auth.js';

const { app } = createTestApp();
const ALLOWED_ORIGIN = 'https://app.example.com';

describe('security headers', () => {
  it('sets hardened headers and hides the framework', async () => {
    const res = await request(app).get('/health').set('X-Health-Key', TEST_HEALTH_KEY);

    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a request ID on every response', async () => {
    const res = await request(app).get('/health').set('X-Health-Key', TEST_HEALTH_KEY);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('CORS', () => {
  it('allows a listed origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Health-Key', TEST_HEALTH_KEY)
      .set('Origin', ALLOWED_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('rejects an unlisted origin with 403 before processing', async () => {
    const res = await request(app)
      .get('/health')
      .set('X-Health-Key', TEST_HEALTH_KEY)
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight requests for allowed origins with the allowed headers', async () => {
    const res = await request(app)
      .options('/chat/messages')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type, X-Request-Nonce');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers['access-control-allow-headers']).toContain('X-Request-Nonce');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('content-type and body validation', () => {
  it('rejects a non-JSON body with 415', async () => {
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('question=hello');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send('{"question": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects a body over the size limit with 413', async () => {
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ question: 'x'.repeat(2048) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('lets a valid JSON body through the gate', async () => {
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send({ question: 'hello' });

    expect([413, 415, 400]).not.toContain(res.status);
  });

  it('allows a body-less POST without a Content-Type', async () => {
    const res = await request(app).post('/anything');
    expect(res.status).not.toBe(415);
  });
});

describe('error responses', () => {
  it('uses the structured error shape with a request ID', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    // Unauthenticated callers get 401 for everything, so routes cannot be probed.
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: expect.any(String),
        requestId: res.headers['x-request-id'],
      },
    });
  });
});

describe('request timeout', () => {
  it('returns 503 when a handler takes too long', async () => {
    const slowApp = express();
    slowApp.use(requestLogger, attachRequestId, requestTimeout(50));
    slowApp.get('/slow', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (!res.headersSent) res.json({ ok: true });
    });
    slowApp.use(errorHandler);

    const res = await request(slowApp).get('/slow');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
  });
});
