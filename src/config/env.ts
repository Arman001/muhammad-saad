import { z } from 'zod';

const commaSeparatedList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.url()).min(1));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url(),

  // Auth provider (OIDC). Issuer must be HTTPS; audience identifies this API.
  AUTH_ISSUER: z.url({ protocol: /^https$/ }),
  AUTH_AUDIENCE: z.string().min(1),

  CORS_ORIGINS: commaSeparatedList,
  HEALTH_API_KEY: z.string().min(16, 'HEALTH_API_KEY must be at least 16 characters'),

  // HTTP hardening
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  BODY_LIMIT: z.string().default('10kb'),

  // Replay protection: how old a request timestamp may be, in seconds
  NONCE_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),

  // Number of trusted reverse proxies in front of the app (for correct client IPs).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Rate limits: requests per window, per IP and per authenticated user.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_GLOBAL_PER_IP: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_PER_IP: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_AUTH_PER_USER: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_CHAT_PER_IP: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_CHAT_PER_USER: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_SUBSCRIPTIONS_PER_IP: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_SUBSCRIPTIONS_PER_USER: z.coerce.number().int().positive().default(30),

  // Simulation settings
  MOCK_AI_LATENCY_MS: z.coerce.number().int().nonnegative().default(800),
  PAYMENT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  BILLING_CRON: z.string().default('*/5 * * * *'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Parses and validates environment variables. Fails fast with a readable
 * message that names the invalid variables without printing their values.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return Object.freeze(result.data);
}

export const config = loadConfig();
