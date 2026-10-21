import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { count, eq, isNull } from '@ayushman-v2/db/drizzle';
import type { Database } from '@ayushman-v2/db';
import { platformMemberships, practices, users } from '@ayushman-v2/db/schema';
import { DATABASE } from '../database.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { PlatformSessionGuard, type PlatformAuthenticatedRequest } from '../auth/session.guard.js';

@Controller('platform')
@UseGuards(PlatformSessionGuard)
export class PlatformController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('overview')
  async overview(@Req() request: PlatformAuthenticatedRequest) {
    await this.authorization.assertPlatformPermission(request.user.id, 'platform.practices.read');
    const [[practiceCount], [userCount], [platformAdminCount]] = await Promise.all([
      this.db.select({ count: count() }).from(practices).where(eq(practices.active, true)),
      this.db.select({ count: count() }).from(users).where(isNull(users.disabledAt)),
      this.db.select({ count: count() }).from(platformMemberships).where(eq(platformMemberships.status, 'active')),
    ]);
    return {
      activePractices: Number(practiceCount.count),
      activeUsers: Number(userCount.count),
      platformOperators: Number(platformAdminCount.count),
    };
  }
}
