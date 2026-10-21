import { z } from 'zod';

const Environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  WEB_ORIGIN: z.preprocess((value) => value === '' ? undefined : value, z.url().default('http://localhost:3101')),
  ADMIN_WEB_ORIGIN: z.preprocess((value) => value === '' ? undefined : value, z.url().default('http://localhost:3102')),
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.url().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  SESSION_COOKIE_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(12),
  PUBLIC_BOOKING_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(30),
  BOOKING_HOLD_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(180),
});

export type Environment = z.infer<typeof Environment>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = Environment.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${details.join('\n')}`);
  }
  const hasUpstashUrl = Boolean(parsed.data.UPSTASH_REDIS_REST_URL);
  const hasUpstashToken = Boolean(parsed.data.UPSTASH_REDIS_REST_TOKEN);
  if (hasUpstashUrl !== hasUpstashToken || (!parsed.data.REDIS_URL && !hasUpstashUrl)) {
    throw new Error('Configure REDIS_URL or both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
  }
  return parsed.data;
}
