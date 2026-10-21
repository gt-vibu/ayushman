import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from '@ayushman-v2/db/drizzle';
import type Redis from 'ioredis';
import type { Database } from '@ayushman-v2/db';
import { DATABASE } from './database.module.js';
import { REDIS } from './redis.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject(REDIS) private readonly redis: Redis) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await Promise.all([this.db.execute(sql`select 1`), this.redis.ping()]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('A required dependency is unavailable');
    }
  }
}
