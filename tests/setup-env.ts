/**
 * Test environment. Runs before each test file is imported, so the config
 * module validates these values instead of reading a developer's .env file.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://app:app@localhost:5433/chatapp_test',
  AUTH_ISSUER: 'https://test-issuer.example.com/',
  AUTH_AUDIENCE: 'https://chat-api.test',
  CORS_ORIGINS: 'https://app.example.com',
  HEALTH_API_KEY: 'test-health-key-0123456789',
  REQUEST_TIMEOUT_MS: '2000',
  BODY_LIMIT: '1kb',
  MOCK_AI_LATENCY_MS: '0',
});
