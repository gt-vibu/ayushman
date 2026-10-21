import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module.js';
import { HealthController } from './health.controller.js';
import { RedisModule } from './redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PracticeSetupModule } from './practice-setup/practice-setup.module.js';
import { BookingModule } from './booking/booking.module.js';
import { StaffInvitationsModule } from './staff-invitations/staff-invitations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { CustomerAccountModule } from './customers/customer-account.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { RecordsModule } from './records/records.module.js';
import { BillingModule } from './billing/billing.module.js';

@Module({ imports: [DatabaseModule, RedisModule, AuthModule, PracticeSetupModule, BookingModule, StaffInvitationsModule, PlatformModule, CustomerAccountModule, GeographyModule, RecordsModule, BillingModule], controllers: [HealthController] })
export class AppModule {}
