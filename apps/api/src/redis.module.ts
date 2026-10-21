import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { readEnvironment } from './config.js';

export const REDIS = Symbol('REDIS');

export interface RedisStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<'OK' | null>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

class UpstashRedisStore implements RedisStore {
  private readonly client: UpstashRedis;

  constructor(url: string, token: string) {
    this.client = new UpstashRedis({ url, token, automaticDeserialization: false });
  }

  incr(key: string) { return this.client.incr(key); }
  expire(key: string, seconds: number) { return this.client.expire(key, seconds); }
  get(key: string) { return this.client.get<string>(key); }
  async set(key: string, value: string, mode: 'EX', seconds: number) {
    if (mode !== 'EX') throw new Error('Only expiring Redis cache entries are supported');
    const result = await this.client.set(key, value, { ex: seconds });
    return result === 'OK' ? 'OK' : null;
  }
  ping() { return this.client.ping(); }
  async quit() { /* Upstash REST uses short-lived HTTP requests; no socket to close. */ }
}

@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: (): RedisStore => {
    const environment = readEnvironment();
    if (environment.UPSTASH_REDIS_REST_URL && environment.UPSTASH_REDIS_REST_TOKEN) {
      return new UpstashRedisStore(environment.UPSTASH_REDIS_REST_URL, environment.UPSTASH_REDIS_REST_TOKEN);
    }
    return new Redis(environment.REDIS_URL!, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  } }],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: RedisStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
