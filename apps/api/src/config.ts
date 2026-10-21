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
  OBJECT_STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  AWS_REGION: z.string().min(1).optional(),
  AWS_S3_BUCKET: z.string().min(3).optional(),
  AWS_S3_PREFIX: z.string().default('ayushman/'),
  AWS_S3_ENDPOINT: z.preprocess((value) => value === '' ? undefined : value, z.url().optional()),
  AWS_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
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
  const hasS3AccessKey = Boolean(parsed.data.AWS_ACCESS_KEY_ID);
  const hasS3SecretKey = Boolean(parsed.data.AWS_SECRET_ACCESS_KEY);
  if (hasS3AccessKey !== hasS3SecretKey) throw new Error('Configure both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  if (parsed.data.OBJECT_STORAGE_DRIVER === 's3' && (!parsed.data.AWS_S3_BUCKET || !parsed.data.AWS_REGION || !hasS3AccessKey)) {
    throw new Error('S3 storage requires AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY');
  }
  return parsed.data;
}
