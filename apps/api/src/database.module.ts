import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@ayushman-v2/db';
import { readEnvironment } from './config.js';

export const DATABASE = Symbol('DATABASE');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  private readonly environment = readEnvironment();
  private readonly connection = createDatabase(this.environment.DATABASE_URL, this.environment.DATABASE_POOL_MAX);
  readonly db = this.connection.db;

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}

@Global()
@Module({
  providers: [
    DatabaseLifecycle,
    { provide: DATABASE, useFactory: (lifecycle: DatabaseLifecycle): Database => lifecycle.db, inject: [DatabaseLifecycle] },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
