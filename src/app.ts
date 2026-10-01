import express from 'express';

export function createApp() {
  const app = express();

  // Temporary: open health check to verify the setup. Will be protected later.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
